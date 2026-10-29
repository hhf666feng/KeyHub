use anyhow::{Context, Result, bail};
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemIntegrationState {
    pub desktop_shortcut: bool,
    pub launch_at_login: bool,
}

pub fn status(executable: &Path) -> Result<SystemIntegrationState> {
    Ok(state_with_autostart_path(
        desktop_shortcut_status(executable)?,
        &autostart_entry_path()?,
    ))
}

fn state_with_autostart_path(desktop_shortcut: bool, path: &Path) -> SystemIntegrationState {
    SystemIntegrationState {
        desktop_shortcut,
        launch_at_login: entry_or_legacy_exists(path),
    }
}

#[cfg(not(target_os = "macos"))]
pub fn set_desktop_shortcut(executable: &Path, enabled: bool) -> Result<SystemIntegrationState> {
    let path = desktop_entry_path(executable)?;
    set_entry(&path, executable, enabled, EntryKind::Desktop)?;
    remove_legacy_entries(&path)?;
    status(executable)
}

#[cfg(target_os = "macos")]
pub fn set_desktop_shortcut(executable: &Path, enabled: bool) -> Result<SystemIntegrationState> {
    if enabled {
        bail!(
            "macOS does not create desktop shortcuts; launch KeyHub from Applications, the Dock, or Spotlight"
        )
    }
    let path = desktop_entry_path(executable)?;
    disable_entries(&path)?;
    status(executable)
}

pub fn set_launch_at_login(executable: &Path, enabled: bool) -> Result<SystemIntegrationState> {
    let path = autostart_entry_path()?;
    set_entry(&path, executable, enabled, EntryKind::Autostart)?;
    remove_legacy_entries(&path)?;
    status(executable)
}

/// Preserve existing opt-ins without creating entries for users who never opted in.
pub fn migrate_legacy_entries(executable: &Path) -> Result<()> {
    #[cfg(not(target_os = "macos"))]
    migrate_entry(
        &desktop_entry_path(executable)?,
        executable,
        EntryKind::Desktop,
    )?;
    migrate_entry(&autostart_entry_path()?, executable, EntryKind::Autostart)?;
    Ok(())
}

fn legacy_entry_paths(path: &Path) -> Vec<PathBuf> {
    let names: &[&str] = match path.file_name().and_then(|name| name.to_str()) {
        Some("KeyHub.lnk") => &["OpenKeylet.lnk", "KRU.lnk"],
        Some("KeyHub.desktop") => &["OpenKeylet.desktop", "KRU.desktop"],
        Some("dev.keyhub.app.plist") => &["dev.openkeylet.app.plist", "dev.kru.app.plist"],
        Some("KeyHub.app") => &["OpenKeylet.app", "KRU.app"],
        Some("KeyHub") => &["OpenKeylet", "KRU"],
        _ => &[],
    };
    names.iter().map(|name| path.with_file_name(name)).collect()
}

fn entry_or_legacy_exists(path: &Path) -> bool {
    owned_entry(path)
        || legacy_entry_paths(path)
            .iter()
            .any(|path| owned_entry(path))
}

fn remove_legacy_entries(path: &Path) -> Result<()> {
    for path in legacy_entry_paths(path) {
        if owned_entry(&path) {
            remove_entry(&path)?;
        }
    }
    Ok(())
}

fn disable_entries(path: &Path) -> Result<()> {
    if owned_entry(path) {
        remove_entry(path)?;
    }
    remove_legacy_entries(path)
}

fn migrate_entry(path: &Path, executable: &Path, kind: EntryKind) -> Result<()> {
    let Some(legacy) = legacy_entry_paths(path)
        .iter()
        .find(|path| owned_entry(path))
        .cloned()
    else {
        return Ok(());
    };
    // An existing canonical entry, including its disabled state, wins.
    if !entry_exists(path) {
        #[cfg(target_os = "windows")]
        set_entry(path, executable, true, kind)?;
        #[cfg(not(target_os = "windows"))]
        {
            let _ = kind;
            let original =
                fs::read_to_string(&legacy).context("Unable to read legacy system entry")?;
            let updated = migrated_entry_text(&original, executable)?;
            fs::write(path, updated).context("Unable to migrate system entry")?;
            fs::set_permissions(path, fs::metadata(&legacy)?.permissions())?;
        }
    } else if !owned_entry(path) {
        return Ok(());
    }
    remove_legacy_entries(path)
}

#[cfg(not(target_os = "windows"))]
fn migrated_entry_text(original: &str, executable: &Path) -> Result<String> {
    #[cfg(target_os = "macos")]
    {
        let label = regex::Regex::new(
            r"(<key>Label</key>\s*<string>)(?:dev\.openkeylet\.app|dev\.kru\.app)(</string>)",
        )?;
        let arguments = regex::Regex::new(
            r"(?s)(<key>ProgramArguments</key>\s*<array>\s*<string>)[^<]+(</string>)",
        )?;
        let text = label.replace(original, "${1}dev.keyhub.app${2}");
        let executable = xml_escape(&executable.to_string_lossy());
        Ok(arguments
            .replace(&text, |captures: &regex::Captures<'_>| {
                format!("{}{executable}{}", &captures[1], &captures[2])
            })
            .into_owned())
    }
    #[cfg(target_os = "linux")]
    {
        Ok(migrated_desktop_entry_text(original, executable))
    }
}

#[cfg(any(test, target_os = "linux"))]
fn migrated_desktop_entry_text(original: &str, executable: &Path) -> String {
    let executable = desktop_exec_quote(&executable.to_string_lossy());
    original
        .split_inclusive('\n')
        .map(|line| {
            let newline = if line.ends_with("\r\n") {
                "\r\n"
            } else if line.ends_with('\n') {
                "\n"
            } else {
                ""
            };
            let replacement = if line.starts_with("Name=") {
                Some("Name=KeyHub".to_owned())
            } else if line.starts_with("Exec=") {
                Some(format!("Exec={executable} gui"))
            } else if line.starts_with("TryExec=") {
                Some(format!("TryExec={executable}"))
            } else if line.starts_with("Icon=") {
                Some("Icon=keyhub".to_owned())
            } else {
                None
            };
            replacement
                .map(|value| format!("{value}{newline}"))
                .unwrap_or_else(|| line.to_owned())
        })
        .collect()
}

fn ensure_owned_entry(path: &Path) -> Result<()> {
    if entry_exists(path) && !owned_entry(path) {
        bail!(
            "Refusing to overwrite an unrelated system entry:{}",
            path.display()
        );
    }
    Ok(())
}

fn managed_executable(command: &str) -> bool {
    let file_name = command
        .trim_matches(['\'', '"'])
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(command);
    let exact_name = Path::new(file_name)
        .file_stem()
        .and_then(|name| name.to_str())
        .is_some_and(|name| {
            ["keyhub", "openkeylet", "kru"]
                .iter()
                .any(|alias| name.eq_ignore_ascii_case(alias))
        });
    // Tauri bundles include the product, semver, and architecture in AppImage
    // names. Do not treat an arbitrary product-prefixed executable as owned.
    exact_name || regex::Regex::new(
        r"(?i)^(?:keyhub|openkeylet|kru)_[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9a-z]+(?:[.-][0-9a-z]+)*)?_(?:amd64|x86_64|aarch64|arm64)\.appimage$",
    ).expect("static AppImage filename regex").is_match(file_name)
}

fn owned_entry(path: &Path) -> bool {
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return false;
    };
    if metadata.file_type().is_symlink() {
        // macOS historically used a desktop symlink to the app bundle. A
        // symlink at a config/shortcut filename is not safe to overwrite.
        return matches!(
            path.file_name().and_then(|name| name.to_str()),
            Some("KeyHub.app" | "OpenKeylet.app" | "KRU.app" | "KeyHub" | "OpenKeylet" | "KRU")
        ) && fs::read_link(path)
            .ok()
            .is_some_and(|target| managed_executable(&target.to_string_lossy()));
    }
    if !metadata.is_file() {
        return false;
    }
    let Ok(bytes) = fs::read(path) else {
        return false;
    };
    if path.extension().is_some_and(|extension| extension == "lnk") {
        return owned_windows_shortcut(&bytes);
    }
    let Ok(text) = std::str::from_utf8(&bytes) else {
        return false;
    };
    if path
        .extension()
        .is_some_and(|extension| extension == "plist")
    {
        let label = regex::Regex::new(
            r"<key>Label</key>\s*<string>dev\.(?:keyhub|openkeylet|kru)\.app</string>",
        )
        .expect("static plist label regex")
        .is_match(text);
        let arguments = regex::Regex::new(r"(?s)<key>ProgramArguments</key>\s*<array>\s*<string>([^<]+)</string>\s*<string>gui</string>\s*</array>").expect("static plist regex");
        return label
            && arguments
                .captures(text)
                .is_some_and(|captures| managed_executable(&captures[1]));
    }
    let field = |name: &str| text.lines().find_map(|line| line.strip_prefix(name));
    field("Type=") == Some("Application")
        && matches!(field("Name="), Some("KeyHub" | "OpenKeylet" | "KRU"))
        && field("TryExec=").is_some_and(managed_executable)
        && field("Exec=")
            .is_some_and(|command| command.strip_suffix(" gui").is_some_and(managed_executable))
}

fn owned_windows_shortcut(bytes: &[u8]) -> bool {
    // Read only the standard Shell Link StringData; no COM or OS changes needed.
    let read_u32 = |offset: usize| {
        bytes
            .get(offset..offset + 4)
            .and_then(|value| value.try_into().ok())
            .map(u32::from_le_bytes)
    };
    if read_u32(0) != Some(76)
        || bytes.get(4..20) != Some(&[1, 20, 2, 0, 0, 0, 0, 0, 192, 0, 0, 0, 0, 0, 0, 70])
    {
        return false;
    }
    let Some(flags) = read_u32(20) else {
        return false;
    };
    let mut offset = 76usize;
    if flags & 1 != 0 {
        let Some(length) = bytes
            .get(offset..offset + 2)
            .map(|value| u16::from_le_bytes([value[0], value[1]]) as usize)
        else {
            return false;
        };
        offset += 2 + length;
    }
    if flags & 2 != 0 {
        let Some(length) = read_u32(offset) else {
            return false;
        };
        let Some(next) = offset.checked_add(length as usize) else {
            return false;
        };
        offset = next;
    }
    let mut description = None;
    let mut arguments = None;
    for bit in 2..=6 {
        if flags & (1 << bit) == 0 {
            continue;
        }
        let Some(length) = bytes
            .get(offset..offset + 2)
            .map(|value| u16::from_le_bytes([value[0], value[1]]) as usize)
        else {
            return false;
        };
        offset += 2;
        let size = length * if flags & 128 != 0 { 2 } else { 1 };
        let Some(value) = bytes.get(offset..offset + size) else {
            return false;
        };
        let value = if flags & 128 != 0 {
            String::from_utf16_lossy(
                &value
                    .chunks_exact(2)
                    .map(|value| u16::from_le_bytes([value[0], value[1]]))
                    .collect::<Vec<_>>(),
            )
        } else {
            String::from_utf8_lossy(value).into_owned()
        };
        if bit == 2 {
            description = Some(value);
        } else if bit == 5 {
            arguments = Some(value);
        }
        offset += size;
    }
    arguments.as_deref() == Some("gui")
        && description.is_some_and(|description| {
            ["KeyHub", "OpenKeylet", "KRU"]
                .iter()
                .any(|name| description == format!("{name} — local credential relay for AI agents"))
        })
}

#[derive(Clone, Copy)]
enum EntryKind {
    #[cfg(not(target_os = "macos"))]
    Desktop,
    Autostart,
}

fn entry_exists(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok()
}

#[cfg(not(target_os = "macos"))]
fn desktop_shortcut_status(executable: &Path) -> Result<bool> {
    Ok(entry_or_legacy_exists(&desktop_entry_path(executable)?))
}

#[cfg(target_os = "macos")]
fn desktop_shortcut_status(_executable: &Path) -> Result<bool> {
    Ok(false)
}

fn remove_entry(path: &Path) -> Result<()> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {
            bail!(
                "Refusing to delete a non-shortcut directory:{}",
                path.display()
            )
        }
        Ok(_) => fs::remove_file(path)
            .with_context(|| format!("Unable to delete system entry:{}", path.display())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => {
            Err(error).with_context(|| format!("Unable to read system entry:{}", path.display()))
        }
    }
}

#[cfg(target_os = "windows")]
fn desktop_entry_path(_executable: &Path) -> Result<PathBuf> {
    Ok(dirs::desktop_dir()
        .context("Desktop directory not found")?
        .join("KeyHub.lnk"))
}

#[cfg(target_os = "windows")]
fn autostart_entry_path() -> Result<PathBuf> {
    Ok(dirs::config_dir()
        .context("Windows configuration directory not found")?
        .join("Microsoft/Windows/Start Menu/Programs/Startup/KeyHub.lnk"))
}

#[cfg(target_os = "windows")]
fn set_entry(path: &Path, executable: &Path, enabled: bool, _kind: EntryKind) -> Result<()> {
    if !enabled {
        return disable_entries(path);
    }
    ensure_owned_entry(path)?;
    create_windows_shortcut(path, executable)
}

#[cfg(target_os = "windows")]
fn create_windows_shortcut(path: &Path, executable: &Path) -> Result<()> {
    use windows::{
        Win32::{
            System::Com::{
                CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, CoCreateInstance, CoInitializeEx,
                CoUninitialize, IPersistFile,
            },
            UI::Shell::{IShellLinkW, ShellLink},
        },
        core::{HSTRING, IUnknown, Interface},
    };

    let parent = path
        .parent()
        .context("Shortcut path is missing a parent directory")?;
    fs::create_dir_all(parent)
        .with_context(|| format!("Unable to create shortcut directory:{}", parent.display()))?;
    let executable = executable
        .canonicalize()
        .with_context(|| format!("KeyHub executable not found:{}", executable.display()))?;
    let working_directory = executable
        .parent()
        .context("KeyHub executable path is missing a parent directory")?;
    let initialized = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }.is_ok();
    let result = (|| -> Result<()> {
        let shell_link: IShellLinkW =
            unsafe { CoCreateInstance(&ShellLink, None::<&IUnknown>, CLSCTX_INPROC_SERVER) }
                .context("Could not create Windows shortcut")?;
        let executable_text = HSTRING::from(windows_shell_path(&executable));
        let working_text = HSTRING::from(windows_shell_path(working_directory));
        let arguments = HSTRING::from("gui");
        let description = HSTRING::from("KeyHub — local credential relay for AI agents");
        unsafe {
            shell_link.SetPath(&executable_text).context("SetPath")?;
            shell_link
                .SetWorkingDirectory(&working_text)
                .context("SetWorkingDirectory")?;
            shell_link
                .SetArguments(&arguments)
                .context("SetArguments")?;
            shell_link
                .SetDescription(&description)
                .context("SetDescription")?;
            shell_link
                .SetIconLocation(&executable_text, 0)
                .context("SetIconLocation")?;
            let persist: IPersistFile = shell_link.cast().context("IPersistFile")?;
            let path_text = HSTRING::from(windows_shell_path(path));
            persist
                .Save(&path_text, true)
                .context("IPersistFile::Save")?;
        }
        Ok(())
    })();
    if initialized {
        unsafe { CoUninitialize() };
    }
    result.with_context(|| format!("Could not write shortcut:{}", path.display()))
}

#[cfg(target_os = "windows")]
fn windows_shell_path(path: &Path) -> String {
    let path = path.to_string_lossy();
    if let Some(path) = path.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{path}")
    } else {
        path.strip_prefix(r"\\?\").unwrap_or(&path).to_owned()
    }
}

#[cfg(target_os = "macos")]
fn desktop_entry_path(executable: &Path) -> Result<PathBuf> {
    let name = if macos_app_bundle(executable).is_some() {
        "KeyHub.app"
    } else {
        "KeyHub"
    };
    Ok(dirs::desktop_dir()
        .context("Desktop directory not found")?
        .join(name))
}

#[cfg(target_os = "macos")]
fn autostart_entry_path() -> Result<PathBuf> {
    Ok(dirs::home_dir()
        .context("Could not find user directory")?
        .join("Library/LaunchAgents/dev.keyhub.app.plist"))
}

#[cfg(target_os = "macos")]
fn macos_app_bundle(executable: &Path) -> Option<PathBuf> {
    executable
        .ancestors()
        .find(|path| path.extension().is_some_and(|extension| extension == "app"))
        .map(Path::to_path_buf)
}

#[cfg(target_os = "macos")]
fn set_entry(path: &Path, executable: &Path, enabled: bool, kind: EntryKind) -> Result<()> {
    if !enabled {
        return disable_entries(path);
    }
    ensure_owned_entry(path)?;
    let parent = path
        .parent()
        .context("System entry path is missing a parent directory")?;
    fs::create_dir_all(parent).with_context(|| {
        format!(
            "Could not create system entry directory:{}",
            parent.display()
        )
    })?;
    remove_entry(path)?;
    match kind {
        EntryKind::Autostart => {
            let executable = xml_escape(executable.to_string_lossy().as_ref());
            let content = format!(
                "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n<plist version=\"1.0\">\n<dict>\n  <key>Label</key><string>dev.keyhub.app</string>\n  <key>ProgramArguments</key><array><string>{executable}</string><string>gui</string></array>\n  <key>RunAtLoad</key><true/>\n</dict>\n</plist>\n"
            );
            fs::write(path, content).with_context(|| {
                format!(
                    "Could not write login startup configuration:{}",
                    path.display()
                )
            })
        }
    }
}

#[cfg(target_os = "macos")]
fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

#[cfg(target_os = "linux")]
fn desktop_entry_path(_executable: &Path) -> Result<PathBuf> {
    Ok(dirs::desktop_dir()
        .context("Desktop directory not found")?
        .join("KeyHub.desktop"))
}

#[cfg(target_os = "linux")]
fn autostart_entry_path() -> Result<PathBuf> {
    Ok(dirs::config_dir()
        .context("Could not find Linux configuration directory")?
        .join("autostart/KeyHub.desktop"))
}

#[cfg(target_os = "linux")]
fn set_entry(path: &Path, executable: &Path, enabled: bool, _kind: EntryKind) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;

    if !enabled {
        return disable_entries(path);
    }
    ensure_owned_entry(path)?;
    let parent = path
        .parent()
        .context("System entry path is missing a parent directory")?;
    fs::create_dir_all(parent).with_context(|| {
        format!(
            "Could not create system entry directory:{}",
            parent.display()
        )
    })?;
    let executable = desktop_exec_quote(executable.to_string_lossy().as_ref());
    let content = format!(
        "[Desktop Entry]\nType=Application\nVersion=1.0\nName=KeyHub\nComment=Local credential relay for AI agents\nExec={executable} gui\nTryExec={executable}\nIcon=keyhub\nTerminal=false\nCategories=Utility;Security;\n"
    );
    fs::write(path, content)
        .with_context(|| format!("Could not write system entry:{}", path.display()))?;
    fs::set_permissions(path, fs::Permissions::from_mode(0o755))
        .with_context(|| format!("Could not set system entry permissions:{}", path.display()))
}

#[cfg(any(test, target_os = "linux"))]
fn desktop_exec_quote(value: &str) -> String {
    format!(
        "\"{}\"",
        value
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
            .replace('`', "\\`")
            .replace('$', "\\$")
    )
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
compile_error!("KeyHub system integration is only supported on Windows, macOS, and Linux");

#[cfg(test)]
mod rename_tests {
    use super::*;

    #[test]
    fn regression_disabled_legacy_returns_false_status_with_unrelated_files_remaining() {
        let temp = tempfile::tempdir().unwrap();
        for (canonical_name, aliases, managed) in [
            (
                "KeyHub.desktop",
                ["OpenKeylet.desktop", "KRU.desktop"],
                "[Desktop Entry]\nType=Application\nName=OpenKeylet\nExec=\"/old/openkeylet\" gui\nTryExec=\"/old/openkeylet\"\n",
            ),
            (
                "dev.keyhub.app.plist",
                ["dev.openkeylet.app.plist", "dev.kru.app.plist"],
                "<plist><dict><key>Label</key><string>dev.openkeylet.app</string><key>ProgramArguments</key><array><string>/old/openkeylet</string><string>gui</string></array></dict></plist>",
            ),
        ] {
            let canonical = temp.path().join(canonical_name);
            let legacy = temp.path().join(aliases[0]);
            let unrelated = temp.path().join(aliases[1]);
            fs::write(&canonical, "unrelated canonical file\n").unwrap();
            fs::write(&legacy, managed).unwrap();
            fs::write(&unrelated, "unrelated legacy file\n").unwrap();
            assert!(state_with_autostart_path(false, &canonical).launch_at_login);

            disable_entries(&canonical).unwrap();
            let state = state_with_autostart_path(false, &canonical);
            assert!(!state.launch_at_login, "{canonical_name}");
            assert!(!state.desktop_shortcut);
            assert!(!entry_or_legacy_exists(&canonical));
            assert!(!legacy.exists());
            assert_eq!(
                fs::read_to_string(&canonical).unwrap(),
                "unrelated canonical file\n"
            );
            assert_eq!(
                fs::read_to_string(&unrelated).unwrap(),
                "unrelated legacy file\n"
            );

            fs::remove_file(&canonical).unwrap();
            assert!(!state_with_autostart_path(false, &canonical).launch_at_login);
            fs::write(&canonical, managed).unwrap();
            assert!(state_with_autostart_path(false, &canonical).launch_at_login);
            disable_entries(&canonical).unwrap();
            assert!(!state_with_autostart_path(false, &canonical).launch_at_login);
        }
    }

    #[test]
    fn regression_versioned_appimage_desktop_entries_remain_owned() {
        let temp = tempfile::tempdir().unwrap();
        let canonical = temp.path().join("KeyHub.desktop");
        for (brand, filename) in [
            ("KeyHub", "KeyHub_0.16.0_amd64.AppImage"),
            ("OpenKeylet", "OpenKeylet_0.15.0_aarch64.AppImage"),
            ("KRU", "KRU_0.14.0_x86_64.AppImage"),
        ] {
            let executable = temp.path().join(filename);
            fs::write(&executable, "fixture executable").unwrap();
            let path = temp.path().join(format!("{brand}.desktop"));
            let content = format!(
                "[Desktop Entry]\nType=Application\nName={brand}\nComment=Local credential relay for AI agents\nExec=\"{}\" gui\nTryExec=\"{}\"\n",
                executable.display(),
                executable.display()
            );
            fs::write(&path, &content).unwrap();
            assert!(owned_entry(&path), "{filename}");
            ensure_owned_entry(&path).unwrap();
            if path == canonical {
                set_entry(&path, &executable, false, EntryKind::Autostart).unwrap();
            } else {
                let migrated = migrated_desktop_entry_text(&content, &executable);
                fs::write(&canonical, migrated).unwrap();
                assert!(owned_entry(&canonical));
                remove_legacy_entries(&canonical).unwrap();
                set_entry(&canonical, &executable, false, EntryKind::Autostart).unwrap();
                assert!(!canonical.exists());
            }
            assert!(!path.exists());
        }
        for filename in [
            "unrelated_0.16.0_amd64.AppImage",
            "KeyHub_helper.AppImage",
            "KeyHub_0.16.0_amd64.AppImage.backup",
            "OpenKeylet_other_amd64.AppImage",
            "KeyHub_0.16.0_unknown.AppImage",
        ] {
            let content = format!(
                "[Desktop Entry]\nType=Application\nName=KeyHub\nExec=\"/opt/{filename}\" gui\nTryExec=\"/opt/{filename}\"\n"
            );
            fs::write(&canonical, &content).unwrap();
            assert!(!owned_entry(&canonical), "{filename}");
            assert!(ensure_owned_entry(&canonical).is_err());
            assert_eq!(fs::read_to_string(&canonical).unwrap(), content);
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn regression_versioned_appimage_round_trips_linux_writer_and_migration() {
        let temp = tempfile::tempdir().unwrap();
        let executable = temp.path().join("KeyHub_0.16.0_amd64.AppImage");
        fs::write(&executable, "fixture executable").unwrap();
        let canonical = temp.path().join("KeyHub.desktop");
        set_entry(&canonical, &executable, true, EntryKind::Autostart).unwrap();
        assert!(owned_entry(&canonical));
        set_entry(&canonical, &executable, false, EntryKind::Autostart).unwrap();
        assert!(!canonical.exists());
        let legacy = temp.path().join("OpenKeylet.desktop");
        fs::write(&legacy, "[Desktop Entry]\nType=Application\nName=OpenKeylet\nExec=\"/old/OpenKeylet_0.15.0_amd64.AppImage\" gui\nTryExec=\"/old/OpenKeylet_0.15.0_amd64.AppImage\"\nHidden=true\n").unwrap();
        migrate_entry(&canonical, &executable, EntryKind::Autostart).unwrap();
        assert!(owned_entry(&canonical));
        assert!(!legacy.exists());
        assert!(
            fs::read_to_string(&canonical)
                .unwrap()
                .contains("Hidden=true\n")
        );
        set_entry(&canonical, &executable, false, EntryKind::Autostart).unwrap();
        assert!(!canonical.exists());
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn regression_disable_removes_owned_legacy_despite_unrelated_canonical() {
        let temp = tempfile::tempdir().unwrap();
        let executable = temp.path().join("keyhub");
        for (canonical_name, legacy_names, content) in [
            (
                "KeyHub.desktop",
                ["OpenKeylet.desktop", "KRU.desktop"],
                "[Desktop Entry]\nType=Application\nName=OpenKeylet\nExec=\"/old/openkeylet\" gui\nTryExec=\"/old/openkeylet\"\n",
            ),
            (
                "dev.keyhub.app.plist",
                ["dev.openkeylet.app.plist", "dev.kru.app.plist"],
                "<plist><dict><key>Label</key><string>dev.openkeylet.app</string><key>ProgramArguments</key><array><string>/old/openkeylet</string><string>gui</string></array></dict></plist>",
            ),
        ] {
            let canonical = temp.path().join(canonical_name);
            fs::write(&canonical, "unrelated canonical user file\n").unwrap();
            let legacy = temp.path().join(legacy_names[0]);
            fs::write(&legacy, content).unwrap();
            assert!(owned_entry(&legacy));
            let unrelated = temp.path().join(legacy_names[1]);
            fs::write(&unrelated, "unrelated legacy user file\n").unwrap();
            set_entry(&canonical, &executable, false, EntryKind::Autostart).unwrap();
            assert!(!legacy.exists());
            assert_eq!(
                fs::read_to_string(&canonical).unwrap(),
                "unrelated canonical user file\n"
            );
            assert_eq!(
                fs::read_to_string(&unrelated).unwrap(),
                "unrelated legacy user file\n"
            );
            set_entry(&canonical, &executable, false, EntryKind::Autostart).unwrap();
        }
    }

    #[test]
    fn keyhub_system_paths_ignore_unowned_files_under_both_legacy_brands() {
        let temp = tempfile::tempdir().unwrap();
        for (canonical, aliases) in [
            ("KeyHub.lnk", ["OpenKeylet.lnk", "KRU.lnk"]),
            ("KeyHub.desktop", ["OpenKeylet.desktop", "KRU.desktop"]),
            (
                "dev.keyhub.app.plist",
                ["dev.openkeylet.app.plist", "dev.kru.app.plist"],
            ),
        ] {
            let path = temp.path().join(canonical);
            for alias in aliases {
                let legacy = temp.path().join(alias);
                fs::write(&legacy, "legacy opt-in").unwrap();
                assert!(!entry_or_legacy_exists(&path), "{alias}");
                fs::remove_file(legacy).unwrap();
            }
        }
    }

    #[test]
    fn keyhub_system_entry_ownership_does_not_follow_filenames_alone() {
        let temp = tempfile::tempdir().unwrap();
        for name in [
            "KeyHub.desktop",
            "OpenKeylet.desktop",
            "KRU.desktop",
            "dev.openkeylet.app.plist",
            "OpenKeylet.lnk",
        ] {
            let path = temp.path().join(name);
            fs::write(&path, "unrelated user file\n").unwrap();
            assert!(!owned_entry(&path));
            assert!(ensure_owned_entry(&path).is_err());
        }
        let path = temp.path().join("KeyHub.desktop");
        remove_legacy_entries(&path).unwrap();
        assert_eq!(
            fs::read_to_string(temp.path().join("OpenKeylet.desktop")).unwrap(),
            "unrelated user file\n"
        );
    }

    #[test]
    fn keyhub_windows_shortcut_ownership_uses_managed_description_and_arguments() {
        for unicode in [true, false] {
            let fixture = |description: &str, arguments: &str| {
                let mut bytes = vec![0; 76];
                bytes[..4].copy_from_slice(&76u32.to_le_bytes());
                bytes[4..20].copy_from_slice(&[1, 20, 2, 0, 0, 0, 0, 0, 192, 0, 0, 0, 0, 0, 0, 70]);
                bytes[20..24]
                    .copy_from_slice(&(4u32 | 32 | if unicode { 128 } else { 0 }).to_le_bytes());
                for text in [description, arguments] {
                    let length = if unicode {
                        text.encode_utf16().count()
                    } else {
                        text.len()
                    };
                    bytes.extend_from_slice(&(length as u16).to_le_bytes());
                    if unicode {
                        bytes.extend(text.encode_utf16().flat_map(u16::to_le_bytes));
                    } else {
                        bytes.extend_from_slice(text.as_bytes());
                    }
                }
                bytes
            };
            for brand in ["KeyHub", "OpenKeylet", "KRU"] {
                let bytes = fixture(
                    &format!("{brand} — local credential relay for AI agents"),
                    "gui",
                );
                assert!(owned_windows_shortcut(&bytes));
                for end in [0, 20, 76, bytes.len() - 1] {
                    assert!(!owned_windows_shortcut(&bytes[..end]));
                }
            }
            assert!(!owned_windows_shortcut(&fixture(
                "unrelated shortcut",
                "gui"
            )));
            assert!(!owned_windows_shortcut(&fixture(
                "KeyHub — local credential relay for AI agents",
                "mcp stdio"
            )));
        }
    }

    #[test]
    fn keyhub_linux_entry_content_keeps_disabled_flags_and_comments() {
        let original = "[Desktop Entry]\r\n# user comment\r\nType=Application\r\nName=OpenKeylet\r\nExec=\"/old/openkeylet\" gui\r\nTryExec=\"/old/openkeylet\"\r\nHidden=true\r\nX-GNOME-Autostart-enabled=false\r\n";
        let temp = tempfile::tempdir().unwrap();
        let legacy = temp.path().join("OpenKeylet.desktop");
        fs::write(&legacy, original).unwrap();
        assert!(owned_entry(&legacy));
        let updated = migrated_desktop_entry_text(original, Path::new("/opt/KeyHub/keyhub"));
        assert!(updated.contains("Name=KeyHub\r\n"));
        assert!(updated.contains("Exec=\"/opt/KeyHub/keyhub\" gui\r\n"));
        assert!(updated.contains("Hidden=true\r\n"));
        assert!(updated.contains("X-GNOME-Autostart-enabled=false\r\n"));
        assert!(updated.contains("# user comment\r\n"));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn keyhub_desktop_migration_keeps_disabled_flags_and_comments() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("KeyHub.desktop");
        let legacy = temp.path().join("OpenKeylet.desktop");
        fs::write(&legacy, "[Desktop Entry]\n# user comment\nType=Application\nName=OpenKeylet\nExec=\"/old/openkeylet\" gui\nTryExec=\"/old/openkeylet\"\nHidden=true\nX-GNOME-Autostart-enabled=false\n").unwrap();
        migrate_entry(&path, &temp.path().join("keyhub"), EntryKind::Autostart).unwrap();
        let text = fs::read_to_string(path).unwrap();
        assert!(text.contains("Name=KeyHub\n"));
        assert!(text.contains("Hidden=true\n"));
        assert!(text.contains("X-GNOME-Autostart-enabled=false\n"));
        assert!(text.contains("# user comment\n"));
        assert!(!legacy.exists());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn keyhub_autostart_writes_only_temp_plist_with_canonical_name() {
        let temp = tempfile::tempdir().unwrap();
        let executable = temp.path().join("KeyHub.app/Contents/MacOS/keyhub");
        let path = temp.path().join("dev.keyhub.app.plist");
        set_entry(&path, &executable, true, EntryKind::Autostart).unwrap();
        let text = fs::read_to_string(&path).unwrap();
        assert!(text.contains("<string>dev.keyhub.app</string>"));
        assert!(text.contains("KeyHub.app/Contents/MacOS/keyhub"));
        assert!(
            autostart_entry_path()
                .unwrap()
                .ends_with("dev.keyhub.app.plist")
        );
        set_entry(&path, &executable, false, EntryKind::Autostart).unwrap();
        assert!(!path.exists());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn keyhub_autostart_migration_keeps_opt_out_and_unrelated_files() {
        let temp = tempfile::tempdir().unwrap();
        let executable = temp.path().join("keyhub");
        let path = temp.path().join("dev.keyhub.app.plist");
        migrate_entry(&path, &executable, EntryKind::Autostart).unwrap();
        assert!(!path.exists());
        let legacy = temp.path().join("dev.openkeylet.app.plist");
        fs::write(&legacy, "<plist><dict><key>Label</key><string>dev.openkeylet.app</string><key>ProgramArguments</key><array><string>/old/openkeylet</string><string>gui</string></array><key>Disabled</key><true/><!-- user comment --></dict></plist>").unwrap();
        let unrelated = temp.path().join("dev.kru.app.plist");
        fs::write(&unrelated, "unrelated file\n").unwrap();
        migrate_entry(&path, &executable, EntryKind::Autostart).unwrap();
        let text = fs::read_to_string(&path).unwrap();
        assert!(text.contains("<key>Disabled</key><true/>"));
        assert!(text.contains("<!-- user comment -->"));
        assert!(!legacy.exists());
        assert_eq!(fs::read_to_string(&unrelated).unwrap(), "unrelated file\n");
        assert!(text.contains("<string>dev.keyhub.app</string>"));
        assert!(text.contains(executable.to_string_lossy().as_ref()));
        let current = fs::read_to_string(&path).unwrap();
        fs::write(&legacy, "<plist><dict><key>Label</key><string>dev.openkeylet.app</string><key>ProgramArguments</key><array><string>/old/openkeylet</string><string>gui</string></array></dict></plist>").unwrap();
        migrate_entry(&path, &executable, EntryKind::Autostart).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), current);
    }
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::create_windows_shortcut;

    #[test]
    fn creates_a_real_windows_shortcut() {
        let directory = tempfile::tempdir().unwrap();
        let shortcut = directory.path().join("OpenKeylet.lnk");
        create_windows_shortcut(&shortcut, &std::env::current_exe().unwrap()).unwrap();
        assert!(shortcut.is_file());
    }
}
