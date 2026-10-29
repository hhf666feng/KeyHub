use crate::{
    agent_registry::{AgentActionResult, AgentClientStatus, AgentRegistry},
    backup,
    browser::BrowserBridge,
    executor,
    github_backup::{self, BackupStatus, ConnectInput, GithubBackup, RestoreResult},
    gui_instance::GuiInstance,
    mcp,
    model::{
        AppState, ConnectionInput, ImportSummary, NewActivity, OwnerEditorDraft, OwnerLockState,
        OwnerSecretView, PublicConnection, SettingsPatch,
    },
    storage::app_data_dir,
    vault::Vault,
};
use anyhow::{Context, Result};
use std::{
    path::{Path, PathBuf},
    process::Command,
    sync::atomic::{AtomicBool, Ordering},
    time::Instant,
};
use tauri::{
    AppHandle, Emitter, LogicalSize, Manager, State, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use tokio::sync::Mutex;
use uuid::Uuid;

pub struct AppRuntime {
    _gui_instance: GuiInstance,
    vault: Vault,
    executable: String,
    browser: BrowserBridge,
    pending_private_key: Mutex<Option<PathBuf>>,
    pending_import: Mutex<Option<PendingImport>>,
    owner_session: Mutex<OwnerSession>,
    github_backup: Mutex<GithubBackup>,
    agent_registry: AgentRegistry,
    tray_available: AtomicBool,
    quick_dismissed_at: std::sync::Mutex<Option<Instant>>,
    window_zoom: Mutex<crate::window_zoom::ZoomState>,
}

struct PendingImport {
    id: String,
    created: Instant,
    encrypted: crate::model::SecretEnvelope,
}

#[derive(Default)]
struct OwnerSession {
    unlocked: bool,
}

const WINDOW_LOGICAL_WIDTH: f64 = 1200.0;
const WINDOW_LOGICAL_HEIGHT: f64 = 800.0;
const WINDOW_MIN_LOGICAL_WIDTH: f64 = 760.0;
const WINDOW_MIN_LOGICAL_HEIGHT: f64 = 600.0;

async fn owner_lock_state(runtime: &AppRuntime) -> Result<OwnerLockState, String> {
    let pin_configured = runtime
        .vault
        .owner_pin_configured()
        .map_err(command_error)?;
    let mut session = runtime.owner_session.lock().await;
    if !pin_configured {
        session.unlocked = false;
        return Ok(OwnerLockState {
            pin_configured,
            unlocked: true,
            expires_in_seconds: 0,
        });
    }
    Ok(OwnerLockState {
        pin_configured,
        unlocked: session.unlocked,
        expires_in_seconds: 0,
    })
}

async fn require_owner_unlocked(runtime: &AppRuntime) -> Result<(), String> {
    if owner_lock_state(runtime).await?.unlocked {
        Ok(())
    } else {
        Err("GUI is locked; enter the six-digit PIN".to_owned())
    }
}

async fn owner_read_guard(
    runtime: &AppRuntime,
) -> Result<tokio::sync::MutexGuard<'_, OwnerSession>, String> {
    let session = runtime.owner_session.lock().await;
    if !runtime
        .vault
        .owner_pin_configured()
        .map_err(command_error)?
        || session.unlocked
    {
        Ok(session)
    } else {
        Err("GUI is locked; enter the six-digit PIN".into())
    }
}

async fn keep_owner_unlocked(runtime: &AppRuntime) {
    runtime.owner_session.lock().await.unlocked = true;
}

fn command_error(error: impl std::fmt::Display) -> String {
    error.to_string()
}

fn emit_changed(app: &AppHandle) {
    let _ = app.emit("state-changed", ());
}

#[tauri::command]
async fn get_state(runtime: State<'_, AppRuntime>) -> Result<AppState, String> {
    runtime.browser.sync().await;
    let browser = runtime.browser.status().await;
    runtime
        .vault
        .app_state(&runtime.executable, browser)
        .map_err(command_error)
}

#[tauri::command]
async fn owner_status(runtime: State<'_, AppRuntime>) -> Result<OwnerLockState, String> {
    owner_lock_state(&runtime).await
}

#[tauri::command]
async fn owner_set_pin(
    runtime: State<'_, AppRuntime>,
    pin: String,
) -> Result<OwnerLockState, String> {
    runtime.vault.set_owner_pin(&pin).map_err(command_error)?;
    keep_owner_unlocked(&runtime).await;
    owner_lock_state(&runtime).await
}

#[tauri::command]
async fn owner_disable_pin(runtime: State<'_, AppRuntime>) -> Result<OwnerLockState, String> {
    require_owner_unlocked(&runtime).await?;
    runtime.vault.disable_owner_pin().map_err(command_error)?;
    runtime.owner_session.lock().await.unlocked = false;
    owner_lock_state(&runtime).await
}

#[tauri::command]
async fn owner_unlock(
    app: AppHandle,
    runtime: State<'_, AppRuntime>,
    pin: String,
) -> Result<OwnerLockState, String> {
    if !runtime
        .vault
        .verify_owner_pin(&pin)
        .map_err(command_error)?
    {
        return Err("Incorrect PIN".to_owned());
    }
    keep_owner_unlocked(&runtime).await;
    emit_changed(&app);
    owner_lock_state(&runtime).await
}

#[tauri::command]
async fn owner_lock(
    app: AppHandle,
    runtime: State<'_, AppRuntime>,
) -> Result<OwnerLockState, String> {
    runtime.owner_session.lock().await.unlocked = false;
    *runtime.pending_import.lock().await = None;
    emit_changed(&app);
    owner_lock_state(&runtime).await
}

#[tauri::command]
async fn owner_secret_view(
    runtime: State<'_, AppRuntime>,
    id: Uuid,
) -> Result<OwnerSecretView, String> {
    let _authorization = owner_read_guard(&runtime).await?;
    runtime.vault.owner_secret_view(id).map_err(command_error)
}

#[tauri::command]
async fn owner_editor_drafts(
    runtime: State<'_, AppRuntime>,
) -> Result<Vec<OwnerEditorDraft>, String> {
    let _authorization = owner_read_guard(&runtime).await?;
    runtime.vault.list_editor_drafts().map_err(command_error)
}

#[tauri::command]
async fn save_editor_draft(
    runtime: State<'_, AppRuntime>,
    draft_id: Option<Uuid>,
    mut input: ConnectionInput,
) -> Result<OwnerEditorDraft, String> {
    require_owner_unlocked(&runtime).await?;
    if input.private_key_import_path == "pending" {
        let path = runtime
            .pending_private_key
            .lock()
            .await
            .take()
            .ok_or_else(|| "Please select the SSH private key again".to_owned())?;
        input.secrets.private_key = Some(std::fs::read_to_string(&path).map_err(command_error)?);
        input.secrets.private_key_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .map(str::to_owned);
    }
    input.private_key_import_path.clear();
    runtime
        .vault
        .save_editor_draft(draft_id, input)
        .map_err(command_error)
}

#[tauri::command]
async fn delete_editor_draft(runtime: State<'_, AppRuntime>, id: Uuid) -> Result<(), String> {
    require_owner_unlocked(&runtime).await?;
    runtime.vault.delete_editor_draft(id).map_err(command_error)
}

#[tauri::command]
async fn copy_owner_value(
    app: AppHandle,
    runtime: State<'_, AppRuntime>,
    value: String,
) -> Result<(), String> {
    let _authorization = owner_read_guard(&runtime).await?;
    app.clipboard().write_text(&value).map_err(command_error)
}

#[tauri::command]
async fn save_connection(
    app: AppHandle,
    runtime: State<'_, AppRuntime>,
    mut input: ConnectionInput,
    expected_updated_at: Option<String>,
) -> Result<PublicConnection, String> {
    require_owner_unlocked(&runtime).await?;
    if input.private_key_import_path == "pending" {
        let selected = runtime
            .pending_private_key
            .lock()
            .await
            .take()
            .ok_or_else(|| "Please select the SSH private key again".to_owned())?;
        input.private_key_import_path = selected.to_string_lossy().into_owned();
    } else {
        input.private_key_import_path.clear();
    }
    let connection = runtime
        .vault
        .save_connection_checked(input, expected_updated_at.as_deref())
        .map_err(command_error)?;
    emit_changed(&app);
    Ok(connection)
}

#[tauri::command]
async fn reorder_connections(
    app: AppHandle,
    runtime: State<'_, AppRuntime>,
    ids: Vec<Uuid>,
    expected_order: Vec<Uuid>,
) -> Result<(), String> {
    require_owner_unlocked(&runtime).await?;
    runtime
        .vault
        .reorder_connections(&ids, &expected_order)
        .map_err(command_error)?;
    emit_changed(&app);
    Ok(())
}

#[tauri::command]
async fn set_connection_enabled(
    app: AppHandle,
    runtime: State<'_, AppRuntime>,
    id: Uuid,
    enabled: bool,
) -> Result<(), String> {
    require_owner_unlocked(&runtime).await?;
    runtime
        .vault
        .set_connection_enabled(id, enabled)
        .map_err(command_error)?;
    emit_changed(&app);
    Ok(())
}

#[tauri::command]
async fn delete_connection(
    app: AppHandle,
    runtime: State<'_, AppRuntime>,
    id: Uuid,
    expected_updated_at: String,
) -> Result<(), String> {
    require_owner_unlocked(&runtime).await?;
    runtime
        .vault
        .trash_connection(id, Some(&expected_updated_at))
        .map_err(command_error)?;
    emit_changed(&app);
    Ok(())
}

#[tauri::command]
async fn owner_trash(
    runtime: State<'_, AppRuntime>,
) -> Result<Vec<crate::model::PublicTrashItem>, String> {
    require_owner_unlocked(&runtime).await?;
    runtime.vault.trash_items().map_err(command_error)
}

#[tauri::command]
async fn owner_restore_item(
    app: AppHandle,
    runtime: State<'_, AppRuntime>,
    id: Uuid,
    deleted_at: String,
) -> Result<(), String> {
    require_owner_unlocked(&runtime).await?;
    runtime
        .vault
        .restore_connection(id, &deleted_at)
        .map_err(command_error)?;
    emit_changed(&app);
    Ok(())
}

#[tauri::command]
async fn owner_purge_item(
    app: AppHandle,
    runtime: State<'_, AppRuntime>,
    id: Uuid,
    deleted_at: String,
) -> Result<(), String> {
    require_owner_unlocked(&runtime).await?;
    runtime
        .vault
        .purge_connection(id, &deleted_at)
        .map_err(command_error)?;
    emit_changed(&app);
    Ok(())
}

#[tauri::command]
async fn owner_password_history(
    runtime: State<'_, AppRuntime>,
    id: Uuid,
) -> Result<serde_json::Value, String> {
    require_owner_unlocked(&runtime).await?;
    let item = runtime.vault.get_connection(id).map_err(command_error)?;
    Ok(
        serde_json::json!({"updatedAt":item.stored.updated_at,"entries":item.secrets.password_history}),
    )
}

#[tauri::command]
async fn owner_clear_password_history(
    app: AppHandle,
    runtime: State<'_, AppRuntime>,
    id: Uuid,
    expected_updated_at: String,
) -> Result<(), String> {
    require_owner_unlocked(&runtime).await?;
    runtime
        .vault
        .clear_password_history(id, &expected_updated_at)
        .map_err(command_error)?;
    emit_changed(&app);
    Ok(())
}

#[tauri::command]
async fn test_connection(
    app: AppHandle,
    runtime: State<'_, AppRuntime>,
    id: Uuid,
) -> Result<String, String> {
    let started = Instant::now();
    let connection = runtime.vault.get_connection(id).map_err(command_error)?;
    let connection_name = connection.stored.name.clone();
    let result: anyhow::Result<String> =
        if connection.stored.test_target(&connection.secrets).is_some() {
            executor::test_connection(&runtime.vault, &connection).await
        } else {
            Ok(format!(
                "Secure entry ready · {} fields",
                connection
                    .secrets
                    .available_fields(connection.stored.secret.as_ref())
                    .len()
            ))
        }
        .map_err(|error| {
            anyhow::anyhow!(crate::policy::redact(
                error.to_string(),
                &connection.stored,
                &connection.secrets,
            ))
        });
    let (status, error) = match &result {
        Ok(_) => ("success", String::new()),
        Err(error) => ("error", error.to_string()),
    };
    let _ = runtime.vault.add_activity(NewActivity {
        status: status.to_owned(),
        source: "Apply".to_owned(),
        connection_name,
        action: "Test connection".to_owned(),
        duration_ms: started.elapsed().as_millis() as u64,
        error,
    });
    emit_changed(&app);
    result.map_err(command_error)
}

#[tauri::command]
async fn update_settings(
    app: AppHandle,
    runtime: State<'_, AppRuntime>,
    patch: SettingsPatch,
) -> Result<crate::model::Settings, String> {
    if let Some(requested) = patch.menu_bar_only {
        let tray_available = runtime.tray_available.load(Ordering::Acquire);
        if requested && (!cfg!(target_os = "macos") || !tray_available) {
            return Err("Menu-bar-only mode requires the macOS status icon".into());
        }
        apply_dock_mode(&app, requested, tray_available).map_err(command_error)?;
    }
    let settings = runtime
        .vault
        .update_settings_patch(patch)
        .map_err(|error| {
            if let Ok(previous) = runtime.vault.settings() {
                let _ = apply_dock_mode(
                    &app,
                    previous.menu_bar_only,
                    runtime.tray_available.load(Ordering::Acquire),
                );
            }
            command_error(error)
        })?;
    runtime.browser.sync().await;
    emit_changed(&app);
    Ok(settings)
}

#[tauri::command]
fn system_integration_status(
    runtime: State<'_, AppRuntime>,
) -> Result<crate::system_integration::SystemIntegrationState, String> {
    crate::system_integration::status(PathBuf::from(&runtime.executable).as_path())
        .map_err(command_error)
}

#[tauri::command]
fn set_desktop_shortcut(
    runtime: State<'_, AppRuntime>,
    enabled: bool,
) -> Result<crate::system_integration::SystemIntegrationState, String> {
    crate::system_integration::set_desktop_shortcut(
        PathBuf::from(&runtime.executable).as_path(),
        enabled,
    )
    .map_err(command_error)
}

#[tauri::command]
fn set_launch_at_login(
    runtime: State<'_, AppRuntime>,
    enabled: bool,
) -> Result<crate::system_integration::SystemIntegrationState, String> {
    crate::system_integration::set_launch_at_login(
        PathBuf::from(&runtime.executable).as_path(),
        enabled,
    )
    .map_err(command_error)
}

#[tauri::command]
async fn clear_activities(app: AppHandle, runtime: State<'_, AppRuntime>) -> Result<(), String> {
    runtime.vault.clear_activities().map_err(command_error)?;
    emit_changed(&app);
    Ok(())
}

#[tauri::command]
async fn copy_mcp_config(
    app: AppHandle,
    _runtime: State<'_, AppRuntime>,
    format: String,
) -> Result<String, String> {
    let config = mcp::render_config(&format).map_err(command_error)?;
    app.clipboard().write_text(&config).map_err(command_error)?;
    Ok(config)
}

#[tauri::command]
async fn agent_mcp_status(
    runtime: State<'_, AppRuntime>,
) -> Result<Vec<AgentClientStatus>, String> {
    Ok(runtime.agent_registry.list().await)
}

#[tauri::command]
async fn agent_mcp_register(
    runtime: State<'_, AppRuntime>,
    client_ids: Vec<String>,
) -> Result<Vec<AgentActionResult>, String> {
    Ok(runtime.agent_registry.register(&client_ids).await)
}

#[tauri::command]
async fn agent_mcp_repair(
    runtime: State<'_, AppRuntime>,
    client_id: String,
) -> Result<AgentActionResult, String> {
    Ok(runtime.agent_registry.repair(&client_id).await)
}

#[tauri::command]
async fn agent_mcp_remove(
    runtime: State<'_, AppRuntime>,
    client_id: String,
) -> Result<AgentActionResult, String> {
    Ok(runtime.agent_registry.remove(&client_id).await)
}

#[tauri::command]
async fn choose_private_key(
    app: AppHandle,
    runtime: State<'_, AppRuntime>,
) -> Result<Option<String>, String> {
    require_owner_unlocked(&runtime).await?;
    let selected = app
        .dialog()
        .file()
        .add_filter("SSH private key", &["pem", "key", "ppk", "txt"])
        .blocking_pick_file();
    let Some(path) = selected else {
        return Ok(None);
    };
    let path = path.into_path().map_err(command_error)?;
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("SSH KEY")
        .to_owned();
    *runtime.pending_private_key.lock().await = Some(path);
    Ok(Some(name))
}

#[tauri::command]
async fn quick_pair_browser(
    app: AppHandle,
    runtime: State<'_, AppRuntime>,
    port: u16,
) -> Result<bool, String> {
    runtime
        .vault
        .update_settings_patch(SettingsPatch {
            browser_enabled: Some(true),
            browser_port: Some(port),
            ..SettingsPatch::default()
        })
        .map_err(command_error)?;
    runtime.browser.sync().await;
    runtime
        .browser
        .start_quick_pairing()
        .await
        .map_err(command_error)?;

    let browser_opened = open_chromium_extensions_page();
    emit_changed(&app);

    Ok(browser_opened)
}

#[tauri::command]
async fn reset_browser_pairing(
    app: AppHandle,
    runtime: State<'_, AppRuntime>,
) -> Result<(), String> {
    runtime
        .browser
        .reset_pairing()
        .await
        .map_err(command_error)?;
    emit_changed(&app);
    Ok(())
}

#[tauri::command]
async fn open_browser_extension_folder(app: AppHandle) -> Result<(), String> {
    let path = browser_extension_path(&app)?;
    app.opener()
        .open_path(path.to_string_lossy(), None::<&str>)
        .map_err(command_error)
}

#[tauri::command]
async fn drag_browser_extension(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    let path = browser_extension_path(&app)?;
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let drag_window = window.clone();
    window
        .run_on_main_thread(move || {
            // Linux's fallible GTK lookup must return through the oneshot sender.
            #[allow(clippy::redundant_closure_call)]
            let result = (|| -> Result<(), String> {
                #[cfg(target_os = "linux")]
                let native = drag_window.gtk_window().map_err(command_error)?;
                #[cfg(target_os = "linux")]
                let handle = &native;
                #[cfg(not(target_os = "linux"))]
                let handle = &drag_window;
                drag::start_drag(
                    handle,
                    drag::DragItem::Files(vec![path]),
                    drag::Image::Raw(include_bytes!("../icons/32x32.png").to_vec()),
                    |_, _| {},
                    drag::Options::default(),
                )
                .map_err(command_error)
            })();
            let _ = sender.send(result);
        })
        .map_err(command_error)?;
    receiver.await.map_err(command_error)?
}

fn browser_extension_path(app: &AppHandle) -> Result<PathBuf, String> {
    let bundled = app
        .path()
        .resource_dir()
        .ok()
        .map(|path| path.join("browser-extension"))
        .filter(|path| path.is_dir());
    let executable = mcp::launcher_executable().map_err(command_error)?;
    let portable = executable
        .parent()
        .map(|path| path.join("browser-extension"))
        .filter(|path| path.is_dir());
    let development = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|path| path.join("browser-extension"))
        .filter(|path| path.is_dir());
    let path = portable.or(bundled).or(development).ok_or_else(|| {
        "browser-extension directory not found; use the complete portable ZIP".to_owned()
    })?;
    Ok(path)
}

#[cfg(windows)]
fn open_chromium_extensions_page() -> bool {
    let mut candidates = Vec::new();
    for root in ["LOCALAPPDATA", "PROGRAMFILES", "PROGRAMFILES(X86)"] {
        let Some(root) = std::env::var_os(root) else {
            continue;
        };
        let root = PathBuf::from(root);
        candidates.push(root.join("Google/Chrome/Application/chrome.exe"));
        candidates.push(root.join("Microsoft/Edge/Application/msedge.exe"));
        candidates.push(root.join("BraveSoftware/Brave-Browser/Application/brave.exe"));
    }
    candidates.extend(["chrome.exe", "msedge.exe", "brave.exe"].map(PathBuf::from));
    candidates.into_iter().any(|candidate| {
        if candidate.components().count() > 1 && !candidate.is_file() {
            return false;
        }
        Command::new(candidate)
            .arg("--new-tab")
            .arg("chrome://extensions")
            .spawn()
            .is_ok()
    })
}

#[cfg(target_os = "macos")]
fn open_chromium_extensions_page() -> bool {
    ["Google Chrome", "Microsoft Edge", "Brave Browser"]
        .into_iter()
        .any(|browser| {
            Command::new("open")
                .args(["-a", browser, "chrome://extensions"])
                .spawn()
                .is_ok()
        })
}

#[cfg(all(unix, not(target_os = "macos")))]
fn open_chromium_extensions_page() -> bool {
    [
        "google-chrome",
        "microsoft-edge",
        "brave-browser",
        "chromium",
    ]
    .into_iter()
    .any(|browser| {
        Command::new(browser)
            .args(["--new-tab", "chrome://extensions"])
            .spawn()
            .is_ok()
    })
}

#[tauri::command]
async fn generate_password(
    runtime: State<'_, AppRuntime>,
    options: crate::generator::Options,
) -> Result<String, String> {
    require_owner_unlocked(&runtime).await?;
    crate::generator::password(&options).map_err(command_error)
}

#[tauri::command]
async fn export_backup(
    app: AppHandle,
    runtime: State<'_, AppRuntime>,
    password: String,
) -> Result<Option<String>, String> {
    require_owner_unlocked(&runtime).await?;
    let password = zeroize::Zeroizing::new(password);
    let selected = app
        .dialog()
        .file()
        .add_filter("KeyHub backup", &["mvault"])
        .set_file_name("keyhub-backup.mvault")
        .blocking_save_file();
    let Some(path) = selected else {
        return Ok(None);
    };
    let path = path.into_path().map_err(command_error)?;
    backup::export_protected(&runtime.vault, &path, &password).map_err(command_error)?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[tauri::command]
async fn github_backup_status(runtime: State<'_, AppRuntime>) -> Result<BackupStatus, String> {
    require_owner_unlocked(&runtime).await?;
    runtime
        .github_backup
        .lock()
        .await
        .status()
        .map_err(command_error)
}

#[tauri::command]
async fn github_backup_account(
    runtime: State<'_, AppRuntime>,
    input: github_backup::AuthInput,
) -> Result<github_backup::AccountStatus, String> {
    require_owner_unlocked(&runtime).await?;
    runtime
        .github_backup
        .lock()
        .await
        .account(input)
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn github_backup_generate_key(runtime: State<'_, AppRuntime>) -> Result<String, String> {
    require_owner_unlocked(&runtime).await?;
    github_backup::generate_recovery_key().map_err(command_error)
}

#[tauri::command]
async fn github_backup_recovery_key(runtime: State<'_, AppRuntime>) -> Result<String, String> {
    require_owner_unlocked(&runtime).await?;
    runtime
        .github_backup
        .lock()
        .await
        .recovery_key()
        .map_err(command_error)
}

#[tauri::command]
async fn github_backup_connect(
    runtime: State<'_, AppRuntime>,
    input: ConnectInput,
) -> Result<BackupStatus, String> {
    require_owner_unlocked(&runtime).await?;
    runtime
        .github_backup
        .lock()
        .await
        .connect(input)
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn github_backup_upload(runtime: State<'_, AppRuntime>) -> Result<BackupStatus, String> {
    require_owner_unlocked(&runtime).await?;
    runtime
        .github_backup
        .lock()
        .await
        .upload()
        .await
        .map_err(command_error)
}

#[tauri::command]
async fn github_backup_restore(
    app: AppHandle,
    runtime: State<'_, AppRuntime>,
) -> Result<RestoreResult, String> {
    require_owner_unlocked(&runtime).await?;
    let result = runtime
        .github_backup
        .lock()
        .await
        .restore()
        .await
        .map_err(command_error)?;
    emit_changed(&app);
    Ok(result)
}

#[tauri::command]
async fn github_backup_disconnect(runtime: State<'_, AppRuntime>) -> Result<BackupStatus, String> {
    require_owner_unlocked(&runtime).await?;
    runtime
        .github_backup
        .lock()
        .await
        .disconnect()
        .map_err(command_error)
}

#[tauri::command]
async fn github_backup_help(app: AppHandle, page: String) -> Result<(), String> {
    let url = match page.as_str() {
        "repository" => "https://github.com/new",
        "token" => "https://github.com/settings/personal-access-tokens/new",
        "login" => "https://cli.github.com/manual/gh_auth_login",
        _ => return Err("GITHUB_HELP_INVALID".to_owned()),
    };
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(command_error)
}

#[tauri::command]
async fn import_backup(
    app: AppHandle,
    runtime: State<'_, AppRuntime>,
    password: String,
) -> Result<Option<ImportSummary>, String> {
    require_owner_unlocked(&runtime).await?;
    let password = zeroize::Zeroizing::new(password);
    let selected = app
        .dialog()
        .file()
        .add_filter("KeyHub backup", &["mvault"])
        .blocking_pick_file();
    let Some(path) = selected else {
        return Ok(None);
    };
    let path = path.into_path().map_err(command_error)?;
    let summary =
        backup::import_with_password(&runtime.vault, &path, &password).map_err(command_error)?;
    emit_changed(&app);
    Ok(Some(summary))
}

#[tauri::command]
async fn prepare_import(
    app: AppHandle,
    runtime: State<'_, AppRuntime>,
    format: String,
) -> Result<Option<serde_json::Value>, String> {
    require_owner_unlocked(&runtime).await?;
    *runtime.pending_import.lock().await = None;
    let extension = match format.as_str() {
        "bitwarden" => "json",
        "chrome" => "csv",
        _ => return Err("Unsupported import format".into()),
    };
    let selected = app
        .dialog()
        .file()
        .add_filter("Vault export", &[extension])
        .blocking_pick_file();
    let Some(path) = selected else {
        return Ok(None);
    };
    require_owner_unlocked(&runtime).await?;
    let parsed = crate::migration::read(&path.into_path().map_err(command_error)?, &format)
        .map_err(command_error)?;
    let id = Uuid::new_v4().to_string();
    let encrypted = runtime
        .vault
        .protect_local_state(&parsed.entries)
        .map_err(command_error)?;
    let result = serde_json::json!({"id":id,"preview":parsed.preview});
    *runtime.pending_import.lock().await = Some(PendingImport {
        id,
        created: Instant::now(),
        encrypted,
    });
    Ok(Some(result))
}

#[tauri::command]
async fn commit_import(
    app: AppHandle,
    runtime: State<'_, AppRuntime>,
    id: String,
) -> Result<ImportSummary, String> {
    require_owner_unlocked(&runtime).await?;
    let mut slot = runtime.pending_import.lock().await;
    let pending = slot.as_ref().ok_or("Choose an import file first")?;
    if pending.id != id {
        return Err("Import preview changed; choose the file again".into());
    }
    if pending.created.elapsed().as_secs() > 300 {
        *slot = None;
        return Err("Import preview expired; choose the file again".into());
    }
    let entries = runtime
        .vault
        .unprotect_local_state(&pending.encrypted)
        .map_err(command_error)?;
    let summary = runtime
        .vault
        .merge_connections(entries)
        .map_err(command_error)?;
    *slot = None;
    emit_changed(&app);
    Ok(summary)
}

#[tauri::command]
async fn cancel_import(runtime: State<'_, AppRuntime>) -> Result<(), String> {
    *runtime.pending_import.lock().await = None;
    Ok(())
}

#[tauri::command]
async fn open_data_folder(app: AppHandle, runtime: State<'_, AppRuntime>) -> Result<(), String> {
    app.opener()
        .open_path(runtime.vault.data_dir().to_string_lossy(), None::<&str>)
        .map_err(command_error)
}

#[tauri::command]
async fn window_action(
    window: WebviewWindow,
    runtime: State<'_, AppRuntime>,
    action: String,
) -> Result<(), String> {
    match action.as_str() {
        "quick" => {
            let tray = window
                .app_handle()
                .tray_by_id("openkeylet-tray")
                .ok_or("Tray unavailable")?;
            let rect = tray
                .rect()
                .map_err(command_error)?
                .ok_or("Tray position unavailable")?;
            toggle_quick_panel(window.app_handle(), rect).map_err(command_error)
        }
        "minimize" => window.minimize().map_err(command_error),
        "maximize" => toggle_workspace_zoom(&window).await,
        "close" => {
            let tray_available = runtime.tray_available.load(Ordering::Acquire);
            if !tray_available {
                window.app_handle().exit(0);
                return Ok(());
            }
            let close_behavior = runtime
                .vault
                .settings()
                .map_err(command_error)?
                .close_behavior;
            if !should_hide_on_close(&close_behavior, tray_available) {
                window.app_handle().exit(0);
                Ok(())
            } else {
                window.hide().map_err(command_error)
            }
        }
        _ => Err("Unknown window operation".to_owned()),
    }
}

/// Zoom on the display that currently contains the window and restore the
/// exact previous frame on the next invocation. Windows/Linux keep native
/// maximize because only macOS has the borderless `mainScreen` fallback.
async fn toggle_workspace_zoom(window: &WebviewWindow) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        if window.is_fullscreen().map_err(command_error)? {
            return Ok(());
        }
        let runtime = window.state::<AppRuntime>();
        let mut zoom = runtime.window_zoom.lock().await;
        let monitor = window
            .current_monitor()
            .map_err(command_error)?
            .or(window.primary_monitor().map_err(command_error)?)
            .ok_or_else(|| "No usable monitor for window zoom".to_owned())?;
        let scale = monitor.scale_factor();
        if !scale.is_finite() || scale <= 0.0 {
            return Err("Invalid monitor scale".to_owned());
        }
        let work_area = monitor.work_area();
        let work_position = work_area.position.to_logical::<f64>(scale);
        let work_size = work_area.size.to_logical::<f64>(scale);
        let work = crate::window_zoom::Frame {
            x: work_position.x,
            y: work_position.y,
            width: work_size.width,
            height: work_size.height,
        };
        let window_scale = window.scale_factor().map_err(command_error)?;
        if !window_scale.is_finite() || window_scale <= 0.0 {
            return Err("Invalid window scale".to_owned());
        }
        let position = window.outer_position().map_err(command_error)?;
        let size = window.outer_size().map_err(command_error)?;
        let current = crate::window_zoom::Frame {
            x: position.x as f64 / window_scale,
            y: position.y as f64 / window_scale,
            width: size.width as f64 / window_scale,
            height: size.height as f64 / window_scale,
        };
        let (target, next) = zoom.next(current, work);
        window
            .set_size(LogicalSize::new(target.width, target.height))
            .map_err(command_error)?;
        window
            .set_position(tauri::LogicalPosition::new(target.x, target.y))
            .map_err(command_error)?;
        // macOS frame setters enqueue AppKit work. Keep one zoom in flight until
        // the queued frame is visible, so a second click cannot save stale bounds.
        for _ in 0..30 {
            let scale = window.scale_factor().map_err(command_error)?;
            let position = window.outer_position().map_err(command_error)?;
            let size = window.outer_size().map_err(command_error)?;
            if (crate::window_zoom::Frame {
                x: position.x as f64 / scale,
                y: position.y as f64 / scale,
                width: size.width as f64 / scale,
                height: size.height as f64 / scale,
            })
            .approximately_equals(target)
            {
                *zoom = next;
                return Ok(());
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
        Err("Window did not reach the requested zoom bounds".to_owned())
    }
    #[cfg(not(target_os = "macos"))]
    {
        if window.is_maximized().map_err(command_error)? {
            window.unmaximize().map_err(command_error)
        } else {
            window.maximize().map_err(command_error)
        }
    }
}

fn should_hide_on_close(close_behavior: &str, tray_available: bool) -> bool {
    tray_available && !close_behavior.eq_ignore_ascii_case("exit")
}

fn show_main_window(app: &AppHandle) {
    if let Some(quick) = app.get_webview_window("quick") {
        let _ = quick.hide();
    }
    #[cfg(target_os = "macos")]
    if !app
        .state::<AppRuntime>()
        .vault
        .settings()
        .map(|settings| settings.menu_bar_only)
        .unwrap_or(false)
    {
        let _ = app.show();
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
    if let Ok(settings) = app.state::<AppRuntime>().vault.settings() {
        let _ = apply_dock_mode(
            app,
            settings.menu_bar_only,
            app.state::<AppRuntime>()
                .tray_available
                .load(Ordering::Acquire),
        );
    }
}

fn apply_dock_mode(app: &AppHandle, requested: bool, tray_available: bool) -> Result<()> {
    #[cfg(target_os = "macos")]
    {
        let resident = crate::quick_panel::resident_mode(requested, tray_available, true);
        app.set_activation_policy(if resident {
            tauri::ActivationPolicy::Accessory
        } else {
            tauri::ActivationPolicy::Regular
        })?;
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, requested, tray_available);
    Ok(())
}

#[tauri::command]
async fn quick_state(runtime: State<'_, AppRuntime>) -> Result<serde_json::Value, String> {
    // Detection may spawn bounded CLI probes; recheck the lock AFTER those await points.
    let agents = runtime
        .agent_registry
        .list()
        .await
        .into_iter()
        .map(|agent| {
            serde_json::json!({
                "clientId": agent.client_id, "displayName": agent.display_name,
                "detected": agent.detected, "state": agent.state,
            })
        })
        .collect::<Vec<_>>();
    let browser = runtime.browser.status().await;
    let session = runtime.owner_session.lock().await;
    let pin_configured = runtime
        .vault
        .owner_pin_configured()
        .map_err(command_error)?;
    let unlocked = !pin_configured || session.unlocked;
    let summary = runtime
        .vault
        .quick_summary(unlocked)
        .map_err(command_error)?;
    let settings = runtime.vault.settings().map_err(command_error)?;
    Ok(serde_json::json!({
        "language":settings.language, "menuBarOnly":settings.menu_bar_only,
        "owner":{"pinConfigured":pin_configured,"unlocked":unlocked},
        "credentials":summary.credentials,"activities":summary.activities,
        "credentialCount":summary.credential_count,"enabledCount":summary.enabled_count,
        "agents":agents,"browser":{"enabled":browser.enabled,"connected":browser.connected,"status":browser.status}
    }))
}

#[tauri::command]
fn quick_open_main(
    app: AppHandle,
    runtime: State<'_, AppRuntime>,
    page: String,
    item_id: Option<Uuid>,
    section: Option<String>,
) -> Result<(), String> {
    if !matches!(page.as_str(), "connections" | "activity" | "settings")
        || section
            .as_ref()
            .is_some_and(|value| !matches!(value.as_str(), "APP" | "MCP" | "WEB"))
    {
        return Err("Unknown workspace route".into());
    }
    if let Some(id) = item_id
        && (page != "connections"
            || !runtime
                .vault
                .quick_summary(true)
                .map_err(command_error)?
                .credentials
                .iter()
                .any(|item| item.id == id))
    {
        return Err("Credential no longer exists".into());
    }
    show_main_window(&app);
    app.emit_to(
        "main",
        "workspace-navigation",
        serde_json::json!({"page":page,"itemId":item_id,"section":section}),
    )
    .map_err(command_error)
}

fn quit_application(app: &AppHandle) {
    if let Err(error) = crate::runtime_epoch::invalidate(app.state::<AppRuntime>().vault.data_dir())
    {
        eprintln!("KeyHub: failed to stop MCP sessions: {error:#}");
    }
    app.exit(0);
}

#[tauri::command]
async fn quick_action(
    app: AppHandle,
    runtime: State<'_, AppRuntime>,
    action: String,
) -> Result<(), String> {
    match action.as_str() {
        "hide" => {
            if let Some(quick) = app.get_webview_window("quick") {
                quick.hide().map_err(command_error)?;
            }
        }
        "lock" => {
            runtime.owner_session.lock().await.unlocked = false;
            *runtime.pending_import.lock().await = None;
            emit_changed(&app);
            if !runtime
                .vault
                .owner_pin_configured()
                .map_err(command_error)?
            {
                show_main_window(&app);
                app.emit_to("main", "pin-setup-requested", ())
                    .map_err(command_error)?;
            }
        }
        "quit" => quit_application(&app),
        _ => return Err("Unknown quick-panel action".into()),
    }
    Ok(())
}

fn toggle_quick_panel(app: &AppHandle, rect: tauri::Rect) -> Result<()> {
    let quick = if let Some(window) = app.get_webview_window("quick") {
        window
    } else {
        WebviewWindowBuilder::new(app, "quick", WebviewUrl::App("quick.html".into()))
            .title("KeyHub Quick Panel")
            .inner_size(crate::quick_panel::WIDTH, crate::quick_panel::HEIGHT)
            .resizable(false)
            .maximizable(false)
            .minimizable(false)
            .decorations(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .visible(false)
            .transparent(true)
            .shadow(true)
            .build()?
    };
    if quick.is_visible()? {
        quick.hide()?;
        return Ok(());
    }
    // Clicking the status item can blur the panel before its click event arrives.
    if app
        .state::<AppRuntime>()
        .quick_dismissed_at
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .take()
        .is_some_and(|time| time.elapsed().as_millis() < 200)
    {
        return Ok(());
    }
    let anchor = rect.position.to_physical::<f64>(1.0);
    #[cfg(target_os = "macos")]
    let monitor = {
        let monitors = app.available_monitors()?;
        let sizes = monitors
            .iter()
            .map(|monitor| {
                [
                    monitor.position().x as f64,
                    monitor.position().y as f64,
                    monitor.size().width as f64,
                    monitor.size().height as f64,
                    monitor.scale_factor(),
                    monitor.work_area().position.y as f64,
                ]
            })
            .collect::<Vec<_>>();
        let anchor_size = rect.size.to_physical::<f64>(1.0);
        crate::quick_panel::macos_monitor_index(
            &sizes,
            [anchor.x, anchor.y, anchor_size.width, anchor_size.height],
        )
        .map(|index| monitors[index].clone())
        .or(app.primary_monitor()?)
    };
    #[cfg(not(target_os = "macos"))]
    let monitor = app
        .monitor_from_point(anchor.x, anchor.y)?
        .or(app.primary_monitor()?);
    if let Some(monitor) = monitor {
        let scale = monitor.scale_factor();
        let anchor = rect.position.to_physical::<f64>(scale);
        let size = rect.size.to_physical::<f64>(scale);
        let work = monitor.work_area();
        let [x, y, width, height] = crate::quick_panel::placement(
            [
                work.position.x as f64,
                work.position.y as f64,
                work.size.width as f64,
                work.size.height as f64,
            ],
            [anchor.x, anchor.y, size.width, size.height],
            scale,
        );
        #[cfg(target_os = "macos")]
        {
            quick.set_position(tauri::LogicalPosition::new(x / scale, y / scale))?;
            quick.set_size(LogicalSize::new(width / scale, height / scale))?;
        }
        #[cfg(not(target_os = "macos"))]
        {
            quick.set_position(tauri::PhysicalPosition::new(x as i32, y as i32))?;
            quick.set_size(tauri::PhysicalSize::new(width as u32, height as u32))?;
        }
    }
    quick.show()?;
    quick.set_focus()?;
    app.emit_to("quick", "state-changed", ())?;
    Ok(())
}

fn install_tray(app: &tauri::App) -> Result<()> {
    let open = MenuItem::with_id(app, "tray-open", "OPEN KeyHub", true, None::<&str>)?;
    let lock = MenuItem::with_id(app, "tray-lock", "LOCK", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "tray-quit", "QUIT", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &lock, &separator, &quit])?;
    let icon = app
        .default_window_icon()
        .context("KeyHub tray icon not found")?
        .clone();

    TrayIconBuilder::with_id("openkeylet-tray")
        .icon(icon)
        .tooltip("KeyHub — LOCAL VAULT")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            if event.id() == "tray-open" {
                show_main_window(app);
            } else if event.id() == "tray-lock" {
                let handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    let pin_configured = handle.state::<AppRuntime>().vault.owner_pin_configured();
                    handle
                        .state::<AppRuntime>()
                        .owner_session
                        .lock()
                        .await
                        .unlocked = false;
                    emit_changed(&handle);
                    show_main_window(&handle);
                    if matches!(pin_configured, Ok(false)) {
                        let _ = handle.emit("pin-setup-requested", ());
                    }
                });
            } else if event.id() == "tray-quit" {
                quit_application(app);
            }
        })
        .on_tray_icon_event(|tray, event| match event {
            TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                rect,
                ..
            }
            | TrayIconEvent::DoubleClick {
                button: MouseButton::Left,
                rect,
                ..
            } => {
                if let Err(error) = toggle_quick_panel(tray.app_handle(), rect) {
                    eprintln!("KeyHub: could not open quick panel: {error:#}");
                    show_main_window(tray.app_handle());
                }
            }
            _ => {}
        })
        .build(app)?;
    Ok(())
}

fn configure_workspace_window(window: &WebviewWindow) -> Result<()> {
    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten())
        .filter(|monitor| {
            let scale_factor = monitor.scale_factor();
            let work_area = monitor.work_area();
            scale_factor.is_finite()
                && scale_factor > 0.0
                && work_area.size.width > 0
                && work_area.size.height > 0
        });
    let mut size = LogicalSize::new(WINDOW_LOGICAL_WIDTH, WINDOW_LOGICAL_HEIGHT);
    if let Some(monitor) = &monitor {
        let work_area = monitor.work_area();
        let available = work_area.size.to_logical::<f64>(monitor.scale_factor());
        size.width = size.width.min(available.width);
        size.height = size.height.min(available.height);
    }
    // Relax the minimum only when the work area is smaller than the workspace floor.
    window.set_min_size(Some(LogicalSize::new(
        WINDOW_MIN_LOGICAL_WIDTH.min(size.width),
        WINDOW_MIN_LOGICAL_HEIGHT.min(size.height),
    )))?;
    window.set_max_size(None::<LogicalSize<f64>>)?;
    window.set_size(size)?;
    window.set_resizable(true)?;
    window.set_maximizable(true)?;
    if let Some(monitor) = &monitor {
        let work_area = monitor.work_area();
        let physical = size.to_physical::<u32>(monitor.scale_factor());
        window.set_position(tauri::PhysicalPosition::new(
            work_area.position.x + (work_area.size.width.saturating_sub(physical.width) / 2) as i32,
            work_area.position.y
                + (work_area.size.height.saturating_sub(physical.height) / 2) as i32,
        ))?;
    }
    Ok(())
}

#[cfg(windows)]
fn request_rounded_corners(window: &WebviewWindow) -> Result<()> {
    use windows::Win32::Graphics::Dwm::{
        DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND, DwmSetWindowAttribute,
    };

    let hwnd = window.hwnd().context("Unable to obtain window handle")?;
    // Match the rounded native Bricktone shell; CSS keeps inner wells at 4px.
    let preference = DWMWCP_ROUND;
    unsafe {
        DwmSetWindowAttribute(
            windows::Win32::Foundation::HWND(hwnd.0),
            DWMWA_WINDOW_CORNER_PREFERENCE,
            &preference as *const _ as *const _,
            size_of_val(&preference) as u32,
        )
        .context("Unable to request a rounded-corner window on Windows")?;
    }
    Ok(())
}

#[cfg(not(windows))]
fn request_rounded_corners(_window: &WebviewWindow) -> Result<()> {
    Ok(())
}

pub fn run_gui() -> Result<()> {
    let data_dir = app_data_dir()?;
    let mut gui_instance = GuiInstance::acquire(&data_dir)?;
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .setup(move |app| {
            let exit_handle = app.handle().clone();
            gui_instance.listen_for_takeover(move || exit_handle.exit(0))?;
            let vault = Vault::open(data_dir.clone())?;
            let executable = mcp::launcher_executable()?.to_string_lossy().into_owned();
            if let Err(error) =
                crate::system_integration::migrate_legacy_entries(Path::new(&executable))
            {
                eprintln!("KeyHub: failed to migrate legacy system shortcuts: {error:#}");
            }
            let browser = BrowserBridge::new(vault.clone());
            let agent_registry = AgentRegistry::new(PathBuf::from(&executable))?;
            agent_registry.refresh_managed_instructions();
            app.manage(AppRuntime {
                _gui_instance: gui_instance,
                github_backup: Mutex::new(GithubBackup::new(vault.clone())?),
                vault,
                executable,
                browser,
                pending_private_key: Mutex::new(None),
                pending_import: Mutex::new(None),
                owner_session: Mutex::new(OwnerSession::default()),
                agent_registry,
                tray_available: AtomicBool::new(false),
                quick_dismissed_at: std::sync::Mutex::new(None),
                window_zoom: Mutex::new(Default::default()),
            });

            let window = app
                .get_webview_window("main")
                .context("Main window not found")?;
            #[cfg(debug_assertions)]
            window.set_title("KeyHub · DEV")?;
            configure_workspace_window(&window)?;
            request_rounded_corners(&window)?;
            match install_tray(app) {
                Ok(()) => app
                    .state::<AppRuntime>()
                    .tray_available
                    .store(true, Ordering::Release),
                Err(error) => {
                    eprintln!(
                        "KeyHub: system tray unavailable; closing the window will exit: {error:#}"
                    )
                }
            }
            let runtime = app.state::<AppRuntime>();
            let tray_available = runtime.tray_available.load(Ordering::Acquire);
            let resident = runtime.vault.settings()?.menu_bar_only;
            #[cfg(target_os = "macos")]
            app.set_activation_policy(
                if crate::quick_panel::resident_mode(resident, tray_available, true) {
                    tauri::ActivationPolicy::Accessory
                } else {
                    tauri::ActivationPolicy::Regular
                },
            );
            if crate::quick_panel::resident_mode(
                resident,
                tray_available,
                cfg!(target_os = "macos"),
            ) {
                window.hide()?;
            } else {
                window.show()?;
            }
            {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    handle.state::<AppRuntime>().browser.sync().await;
                    emit_changed(&handle);
                });
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "quick" {
                match event {
                    tauri::WindowEvent::Focused(false) => {
                        *window
                            .state::<AppRuntime>()
                            .quick_dismissed_at
                            .lock()
                            .unwrap_or_else(|error| error.into_inner()) = Some(Instant::now());
                        let _ = window.hide();
                    }
                    tauri::WindowEvent::CloseRequested { api, .. } => {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                    _ => {}
                }
                return;
            }
            #[cfg(target_os = "macos")]
            if matches!(event, tauri::WindowEvent::Focused(true)) {
                let runtime = window.state::<AppRuntime>();
                if let Ok(settings) = runtime.vault.settings() {
                    let _ = apply_dock_mode(
                        window.app_handle(),
                        settings.menu_bar_only,
                        runtime.tray_available.load(Ordering::Acquire),
                    );
                }
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let runtime = window.state::<AppRuntime>();
                let close_behavior = runtime
                    .vault
                    .settings()
                    .map(|settings| settings.close_behavior)
                    .unwrap_or_else(|_| "exit".to_owned());
                if should_hide_on_close(
                    &close_behavior,
                    runtime.tray_available.load(Ordering::Acquire),
                ) {
                    api.prevent_close();
                    let _ = window.hide();
                } else if let Err(error) =
                    crate::runtime_epoch::invalidate(runtime.vault.data_dir())
                {
                    eprintln!("KeyHub: failed to stop MCP sessions: {error:#}");
                }
            }
        })
        .invoke_handler(|invoke| {
            if invoke.message.webview_ref().label() == "quick"
                && !crate::quick_panel::allowed_command(invoke.message.command())
            {
                invoke
                    .resolver
                    .reject("Command is not available in the quick panel");
                return true;
            }
            let handler: fn(tauri::ipc::Invoke<tauri::Wry>) -> bool = tauri::generate_handler![
                get_state,
                owner_status,
                owner_set_pin,
                owner_disable_pin,
                owner_unlock,
                owner_lock,
                owner_secret_view,
                owner_editor_drafts,
                save_editor_draft,
                delete_editor_draft,
                copy_owner_value,
                save_connection,
                reorder_connections,
                set_connection_enabled,
                delete_connection,
                owner_trash,
                owner_restore_item,
                owner_purge_item,
                owner_password_history,
                owner_clear_password_history,
                test_connection,
                update_settings,
                system_integration_status,
                set_desktop_shortcut,
                set_launch_at_login,
                clear_activities,
                copy_mcp_config,
                agent_mcp_status,
                agent_mcp_register,
                agent_mcp_repair,
                agent_mcp_remove,
                choose_private_key,
                quick_pair_browser,
                reset_browser_pairing,
                open_browser_extension_folder,
                drag_browser_extension,
                export_backup,
                generate_password,
                import_backup,
                prepare_import,
                commit_import,
                cancel_import,
                github_backup_status,
                github_backup_account,
                github_backup_generate_key,
                github_backup_recovery_key,
                github_backup_connect,
                github_backup_upload,
                github_backup_restore,
                github_backup_disconnect,
                github_backup_help,
                open_data_folder,
                window_action,
                quick_state,
                quick_open_main,
                quick_action,
            ];
            handler(invoke)
        })
        .build(tauri::generate_context!())
        .context("KeyHub GUI startup failed")?;

    #[cfg(target_os = "macos")]
    app.run(|app, event| match event {
        tauri::RunEvent::Ready => {
            let runtime = app.state::<AppRuntime>();
            if let Ok(settings) = runtime.vault.settings() {
                let _ = apply_dock_mode(
                    app,
                    settings.menu_bar_only,
                    runtime.tray_available.load(Ordering::Acquire),
                );
            }
        }
        tauri::RunEvent::Reopen { .. } => show_main_window(app),
        _ => {}
    });

    #[cfg(not(target_os = "macos"))]
    app.run(|app, event| {
        // A hidden development launcher can pass its initial show state to the
        // child process. Explicitly show the GUI once its event loop is ready.
        if matches!(event, tauri::RunEvent::Ready) {
            show_main_window(app);
        }
    });

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::should_hide_on_close;

    #[test]
    fn close_only_hides_when_a_tray_entry_exists() {
        assert!(should_hide_on_close("tray", true));
        assert!(!should_hide_on_close("tray", false));
        assert!(!should_hide_on_close("exit", true));
    }
}
