use crate::{
    browser::{BrowserBridge, current_totp},
    desktop,
    executor::{ApiRequestInput, execute_api, execute_ssh},
    model::NewActivity,
    terminal::TerminalManager,
    vault::Vault,
};
use anyhow::{Context, Result, bail};
use rmcp::{
    ServerHandler, ServiceExt,
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    model::{ServerCapabilities, ServerInfo},
    service::{MaybeSendFuture, NotificationContext, RoleServer},
    tool, tool_handler, tool_router,
    transport::stdio,
};
use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::json;
use std::{
    path::Path,
    sync::{Arc, RwLock},
    time::{Duration, Instant},
};
use tokio::time::sleep;
use uuid::Uuid;

#[derive(Clone)]
pub struct VaultMcp {
    vault: Vault,
    browser: BrowserBridge,
    terminal: TerminalManager,
    client_name: Arc<RwLock<String>>,
    tool_router: ToolRouter<Self>,
}

impl std::fmt::Debug for VaultMcp {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.debug_struct("VaultMcp").finish_non_exhaustive()
    }
}

impl VaultMcp {
    pub fn new(vault: Vault) -> Self {
        Self {
            browser: BrowserBridge::new(vault.clone()),
            terminal: TerminalManager::new(),
            client_name: Arc::new(RwLock::new(String::new())),
            vault,
            tool_router: Self::tool_router(),
        }
    }

    fn activity_source(&self) -> String {
        let client_name = self
            .client_name
            .read()
            .map(|name| name.clone())
            .unwrap_or_default();
        if client_name.is_empty() {
            "MCP CLIENT".to_owned()
        } else {
            format!("MCP · {client_name}")
        }
    }

    async fn require_approval(&self, item_id: Uuid, action: &str, detail: &str) -> Result<bool> {
        let Some(request) =
            self.vault
                .create_approval_request(item_id, &self.activity_source(), action, detail)?
        else {
            return Ok(false);
        };
        for _ in 0..240 {
            sleep(Duration::from_millis(250)).await;
            match self.vault.approval_status(request.id)?.as_deref() {
                Some("approved") => {
                    self.vault.remove_approval(request.id)?;
                    return Ok(true);
                }
                Some("denied") => {
                    self.vault.remove_approval(request.id)?;
                    bail!("The user rejected this call");
                }
                Some("pending") => {}
                Some("expired") | None => bail!("The approval request was canceled or expired"),
                Some(_) => bail!("The approval request has an invalid status"),
            }
        }
        self.vault.remove_approval(request.id)?;
        bail!("Timed out waiting for user approval; open KRU and try again")
    }

    async fn track<T, F>(&self, item_id: Uuid, action: String, future: F) -> Result<T, String>
    where
        F: std::future::Future<Output = Result<T>>,
    {
        let started = Instant::now();
        let decrypted = self.vault.get_connection(item_id).ok();
        let item_name = decrypted
            .as_ref()
            .map(|connection| connection.stored.name.clone())
            .unwrap_or_else(|| "Unknown project".to_owned());
        match future.await {
            Ok(value) => {
                let _ = self.vault.add_activity(NewActivity {
                    status: "success".to_owned(),
                    source: self.activity_source(),
                    connection_name: item_name,
                    action,
                    duration_ms: started.elapsed().as_millis() as u64,
                    error: String::new(),
                });
                Ok(value)
            }
            Err(error) => {
                let message = decrypted.as_ref().map_or_else(
                    || error.to_string(),
                    |connection| {
                        crate::policy::redact(
                            error.to_string(),
                            &connection.stored,
                            &connection.secrets,
                        )
                    },
                );
                let _ = self.vault.add_activity(NewActivity {
                    status: "error".to_owned(),
                    source: self.activity_source(),
                    connection_name: item_name,
                    action,
                    duration_ms: started.elapsed().as_millis() as u64,
                    error: message.clone(),
                });
                Err(message)
            }
        }
    }
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct SshExecuteInput {
    #[schemars(description = "Item ID returned by vault_items_list, with the SSH action inferred automatically")]
    connection_id: String,
    #[schemars(description = "Single command to execute")]
    command: String,
    #[serde(default)]
    #[schemars(description = "Optional remote working directory")]
    cwd: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct ApiToolInput {
    #[schemars(description = "Item ID returned by vault_items_list, with the HTTP action inferred automatically")]
    connection_id: String,
    #[serde(flatten)]
    request: ApiRequestInput,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct SecretFillInput {
    #[schemars(description = "Item ID returned by vault_items_list")]
    item_id: String,
    #[schemars(description = "Secret field name returned by vault_items_list")]
    field: String,
    #[schemars(
        description = "Write target: browser (paired extension, recommended for reliable browser automation), desktop (only when real operating system foreground focus can be guaranteed), or terminal"
    )]
    target: String,
    #[serde(default)]
    #[schemars(description = "target=Required for terminal; returned by terminal_open")]
    session_id: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct TerminalOpenInput {
    #[schemars(description = "Program name or path chosen by the Agent to run; launch directly without a Shell")]
    program: String,
    #[serde(default)]
    #[schemars(description = "Arguments passed as separate argv values")]
    args: Vec<String>,
    #[serde(default)]
    #[schemars(description = "Optional absolute working directory")]
    cwd: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct TerminalSessionInput {
    #[schemars(description = "Session ID returned by terminal_open")]
    session_id: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct TerminalInputInput {
    #[schemars(description = "Session ID returned by terminal_open")]
    session_id: String,
    #[schemars(description = "Ordinary terminal input; the Agent adds a newline at the end when Enter is needed")]
    text: String,
}

#[tool_router(router = tool_router)]
impl VaultMcp {
    #[tool(
        name = "vault_items_list",
        description = "Lists KRU items, modules, and supported actions enabled for the Agent. Plaintext values are included only for modules the user explicitly enabled as Agent-visible; other modules return names and configuration status only."
    )]
    async fn vault_items_list(&self) -> Result<String, String> {
        let items = self
            .vault
            .list_connections()
            .map_err(|error| error.to_string())?
            .into_iter()
            .filter(|item| item.enabled && !item.capabilities.is_empty())
            .map(|item| -> Result<serde_json::Value, String> {
                let decrypted = self
                    .vault
                    .get_connection(item.id)
                    .map_err(|error| error.to_string())?;
                let modules = decrypted
                    .stored
                    .modules
                    .iter()
                    .map(|module| -> Result<serde_json::Value, String> {
                        let agent_visible = module.agent_visible();
                        let configured = if let Some(name) = module.secret_name() {
                            decrypted.secrets.get(name).is_some()
                        } else {
                            !module.value.trim().is_empty()
                        };
                        let mut output = json!({
                            "kind": module.kind,
                            "name": module.name,
                            "secret": module.is_secret(),
                            "configured": configured,
                            "agentVisible": agent_visible,
                        });
                        if agent_visible {
                            let mut value = if let Some(name) = module.secret_name() {
                                decrypted.secrets.get(name).unwrap_or_default().to_owned()
                            } else {
                                module.value.clone()
                            };
                            if module.kind == "totp" && !value.is_empty() {
                                value = current_totp(&value).map_err(|error| error.to_string())?;
                            }
                            output["value"] = json!(value);
                        }
                        Ok(output)
                    })
                    .collect::<Result<Vec<_>, _>>()?;
                let fields = item
                    .secret
                    .as_ref()
                    .map(|profile| profile.fields.iter().map(|field| json!({
                        "name": field.name,
                        "type": field.kind,
                        "agentVisible": decrypted.stored.modules.iter().find(|module| module.secret_name() == Some(field.name.as_str())).is_some_and(|module| module.agent_visible()),
                    })).collect::<Vec<_>>())
                    .unwrap_or_default();
                let has_ssh = item.capabilities.iter().any(|value| value == "ssh");
                let has_http = item.capabilities.iter().any(|value| value == "http");
                let mut target = json!({});
                let mut actions = Vec::new();
                if item.capabilities.iter().any(|value| value == "fill") {
                    actions.push("secret_fill");
                }
                if has_ssh {
                    let mut ssh = json!({"mode": item.security_mode, "allowedCommands": item.allowed_commands});
                    if decrypted.stored.modules.iter().find(|module| module.kind == "host").is_some_and(|module| module.agent_visible()) {
                        ssh["host"] = json!(item.host);
                    }
                    if decrypted.stored.modules.iter().find(|module| module.kind == "port").is_some_and(|module| module.agent_visible()) {
                        ssh["port"] = json!(item.port);
                    }
                    target["ssh"] = ssh;
                    actions.push("ssh_execute");
                }
                if has_http {
                    let url_visible = decrypted.stored.modules.iter().find(|module| module.kind == "url").is_some_and(|module| module.agent_visible());
                    let mut http = json!({"runtimeUrlRequired": item.base_url.is_empty(), "methods": item.allowed_methods, "pathPrefixes": item.allowed_path_prefixes});
                    if url_visible {
                        http["baseUrl"] = json!(item.base_url);
                    }
                    target["http"] = http;
                    actions.push("api_request");
                }
                Ok(json!({
                    "id": item.id,
                    "name": item.name,
                    "type": "item",
                    "capabilities": item.capabilities,
                    "modules": modules,
                    "description": item.description,
                    "fields": fields,
                    "target": target,
                    "actions": actions,
                }))
            })
            .collect::<Result<Vec<_>, _>>()?;
        serde_json::to_string_pretty(&json!({"items": items})).map_err(|error| error.to_string())
    }

    #[tool(
        name = "secret_fill",
        description = "Writes a saved field into the control focused by the Agent or the specified KRU terminal. For reliable browser automation, use browser with the paired extension; use desktop only when you can guarantee real operating system foreground focus. KRU does not judge the purpose, submit automatically, or return field values."
    )]
    async fn secret_fill(
        &self,
        Parameters(input): Parameters<SecretFillInput>,
    ) -> Result<String, String> {
        let item_id = Uuid::parse_str(&input.item_id).map_err(|_| "Invalid project ID".to_owned())?;
        let target = match input.target.as_str() {
            "browser" | "desktop" | "terminal" => input.target,
            _ => return Err("target must be browser, desktop, or terminal".to_owned()),
        };
        let field = input.field;
        self.track(item_id, format!("to {target} Fill fields {field}"), async {
            let was_approved = self
                .require_approval(item_id, "Fill a secret", &format!("{target} · {field}"))
                .await?;
            if was_approved && target == "desktop" {
                sleep(Duration::from_secs(5)).await;
            }
            let (_, kind, mut value) = self.vault.get_secret_value(item_id, &field)?;
            if kind == "totp" {
                value = current_totp(&value)?;
            }
            match target.as_str() {
                "browser" => {
                    let result = self.browser.fill_value(value).await?;
                    if result.status != "ok" {
                        bail!("{}", result.message);
                    }
                }
                "desktop" => {
                    tokio::task::spawn_blocking(move || desktop::fill_focused(&value))
                        .await
                        .context("Desktop input task failed")??;
                }
                "terminal" => {
                    let session_id = input
                        .session_id
                        .as_deref()
                        .context("target=sessionId is required when target is terminal")?;
                    let session_id = Uuid::parse_str(session_id)
                        .map_err(|_| anyhow::anyhow!("Invalid terminal session ID"))?;
                    self.terminal.fill_value(session_id, &value)?;
                }
                _ => unreachable!(),
            }
            Ok(())
        })
        .await?;
        serde_json::to_string(&json!({"ok": true, "target": target, "field": field}))
            .map_err(|error| error.to_string())
    }

    #[tool(
        name = "terminal_open",
        description = "Launch a program directly in a KRU-managed local PTY. The Agent chooses the program and argv; no Shell is used."
    )]
    async fn terminal_open(
        &self,
        Parameters(input): Parameters<TerminalOpenInput>,
    ) -> Result<String, String> {
        let result = self
            .terminal
            .open(&input.program, input.args, input.cwd)
            .map_err(|error| error.to_string())?;
        serde_json::to_string_pretty(&result).map_err(|error| error.to_string())
    }

    #[tool(
        name = "terminal_input",
        description = "Write ordinary text to a KRU-managed PTY. secret_fill does not append a newline automatically; when submission is needed, the Agent must send Enter separately."
    )]
    async fn terminal_input(
        &self,
        Parameters(input): Parameters<TerminalInputInput>,
    ) -> Result<String, String> {
        let session_id =
            Uuid::parse_str(&input.session_id).map_err(|_| "Invalid terminal session ID".to_owned())?;
        self.terminal
            .input(session_id, &input.text)
            .map_err(|error| error.to_string())?;
        Ok("{\"ok\":true}".to_owned())
    }

    #[tool(
        name = "terminal_read",
        description = "Read PTY output since the previous call and process status; secrets filled by KRU and common encoded forms are redacted."
    )]
    async fn terminal_read(
        &self,
        Parameters(input): Parameters<TerminalSessionInput>,
    ) -> Result<String, String> {
        let session_id =
            Uuid::parse_str(&input.session_id).map_err(|_| "Invalid terminal session ID".to_owned())?;
        let result = self
            .terminal
            .read(session_id)
            .map_err(|error| error.to_string())?;
        serde_json::to_string_pretty(&result).map_err(|error| error.to_string())
    }

    #[tool(
        name = "terminal_close",
        description = "Close and clean up the KRU-managed PTY; terminate the program if it is still running."
    )]
    async fn terminal_close(
        &self,
        Parameters(input): Parameters<TerminalSessionInput>,
    ) -> Result<String, String> {
        let session_id =
            Uuid::parse_str(&input.session_id).map_err(|_| "Invalid terminal session ID".to_owned())?;
        self.terminal
            .close(session_id)
            .map_err(|error| error.to_string())?;
        Ok("{\"ok\":true}".to_owned())
    }

    #[tool(
        name = "ssh_execute",
        description = "Execute policy-restricted commands on a saved VPS using the local vault; authentication information is not returned to the Agent."
    )]
    async fn ssh_execute(
        &self,
        Parameters(input): Parameters<SshExecuteInput>,
    ) -> Result<String, String> {
        let connection_id =
            Uuid::parse_str(&input.connection_id).map_err(|_| "Invalid connection ID".to_owned())?;
        let connection = self
            .vault
            .get_connection(connection_id)
            .map_err(|error| error.to_string())?;
        if !connection.stored.has_capability("ssh") {
            return Err("The selected project’s modules do not yet form a usable SSH action".to_owned());
        }
        let result = self
            .track(connection_id, "Run SSH command".to_owned(), async {
                self.require_approval(connection_id, "Run SSH command", &input.command)
                    .await?;
                execute_ssh(
                    &self.vault,
                    &connection,
                    &input.command,
                    input.cwd.as_deref(),
                )
                .await
            })
            .await?;
        serde_json::to_string_pretty(&result).map_err(|error| error.to_string())
    }

    #[tool(
        name = "api_request",
        description = "Call an API; authentication is injected by KRU. The same origin is locked when a URL is saved; otherwise, the caller provides an absolute HTTPS URL (HTTP is allowed for localhost loopback)."
    )]
    async fn api_request(
        &self,
        Parameters(input): Parameters<ApiToolInput>,
    ) -> Result<String, String> {
        let connection_id =
            Uuid::parse_str(&input.connection_id).map_err(|_| "Invalid connection ID".to_owned())?;
        let connection = self
            .vault
            .get_connection(connection_id)
            .map_err(|error| error.to_string())?;
        if !connection.stored.has_capability("http") {
            return Err("The selected project’s modules do not yet form a usable HTTP action".to_owned());
        }
        let action = format!("Send {} API request", input.request.method.to_uppercase());
        let approval_detail = format!(
            "{} {}",
            input.request.method.to_uppercase(),
            if input.request.url.is_empty() {
                input.request.path.as_str()
            } else {
                input.request.url.as_str()
            }
        );
        let result = self
            .track(connection_id, action, async {
                if connection.secrets.has_auth_secret() {
                    self.require_approval(connection_id, "Send an API request", &approval_detail)
                        .await?;
                }
                execute_api(&connection, input.request).await
            })
            .await?;
        serde_json::to_string_pretty(&result).map_err(|error| error.to_string())
    }
}

#[tool_handler(router = self.tool_router)]
impl ServerHandler for VaultMcp {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build()).with_instructions(
            "KRU is a non-intelligent local credential execution tool. First use vault_items_list to choose an item and field. A module includes its value only when the user has enabled Agent visibility; if there is no value, do not request or guess it—call secret_fill, ssh_execute, or api_request. For reliable browser automation, use the target of the paired extension=browser；target=Use desktop only when you can guarantee real operating system foreground focus. Background DOM focus is not the same as operating system foreground focus.",
        )
    }

    fn on_initialized(
        &self,
        context: NotificationContext<RoleServer>,
    ) -> impl std::future::Future<Output = ()> + MaybeSendFuture + '_ {
        if let Some(info) = context.peer.peer_info() {
            let client_name = display_client_name(&info.client_info.name);
            if let Ok(mut stored_name) = self.client_name.write() {
                *stored_name = client_name;
            }
        }
        std::future::ready(())
    }
}

fn display_client_name(raw_name: &str) -> String {
    let normalized = raw_name.trim().to_ascii_lowercase();
    if normalized.contains("claude") {
        "CLAUDE CODE".to_owned()
    } else if normalized.contains("codex") {
        "CODEX".to_owned()
    } else if normalized.contains("cursor") {
        "CURSOR".to_owned()
    } else if normalized.contains("opencode") {
        "OPENCODE".to_owned()
    } else if normalized.contains("chatgpt") {
        "CHATGPT".to_owned()
    } else {
        raw_name
            .trim()
            .chars()
            .filter(|character| !character.is_control())
            .take(24)
            .collect::<String>()
            .to_uppercase()
    }
}

pub async fn serve_stdio(vault: Vault) -> Result<()> {
    let service = VaultMcp::new(vault).serve(stdio()).await?;
    service.waiting().await?;
    Ok(())
}

pub fn render_config(format: &str) -> Result<String> {
    let executable = std::env::current_exe().context("Unable to determine the KRU executable path")?;
    let executable = path_text(&executable);
    match format {
        "stdio-json" => Ok(serde_json::to_string_pretty(&json!({
            "mcpServers": {"kru": {"command": executable, "args": ["mcp", "stdio"]}}
        }))?),
        "stdio-toml" => Ok(format!(
            "[mcp_servers.kru]\ncommand = \"{}\"\nargs = [\"mcp\", \"stdio\"]",
            toml_escape(&executable)
        )),
        _ => bail!("Unknown configuration format:{format}"),
    }
}

fn path_text(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn toml_escape(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{
        ConnectionInput, ItemModule, NamedSecrets, SecretBundle, SecretField, SecretProfile,
    };
    use tempfile::tempdir;

    #[tokio::test]
    async fn item_list_only_exposes_values_enabled_by_user() {
        let directory = tempdir().unwrap();
        let vault = Vault::open(directory.path().join("vault")).unwrap();
        let mut named = NamedSecrets::default();
        named.insert("username".into(), "mcp-visible-user-marker".into());
        named.insert("password".into(), "mcp-hidden-password-marker".into());
        let mut secrets = SecretBundle::default();
        secrets.named_secrets = named;
        let saved = vault
            .save_connection(ConnectionInput {
                id: None,
                kind: "secret".into(),
                capabilities: vec!["fill".into()],
                modules: vec![
                    ItemModule {
                        kind: "username".into(),
                        name: String::new(),
                        value: String::new(),
                        agent_visible: Some(true),
                    },
                    ItemModule {
                        kind: "password".into(),
                        name: String::new(),
                        value: String::new(),
                        agent_visible: Some(false),
                    },
                ],
                name: "test login".into(),
                enabled: true,
                description: String::new(),
                host: String::new(),
                port: 0,
                username: String::new(),
                auth_type: String::new(),
                ssh_auth_type: String::new(),
                http_auth_type: String::new(),
                private_key_import_path: String::new(),
                host_fingerprint: String::new(),
                security_mode: String::new(),
                allowed_commands: vec![],
                base_url: String::new(),
                auth_header: String::new(),
                auth_location: String::new(),
                auth_prefix: String::new(),
                api_auth_headers: vec![],
                allowed_methods: vec![],
                allowed_path_prefixes: vec![],
                test_path: String::new(),
                cli: None,
                browser: None,
                credential: None,
                secret: Some(SecretProfile {
                    fields: vec![
                        SecretField {
                            name: "username".into(),
                            kind: "text".into(),
                        },
                        SecretField {
                            name: "password".into(),
                            kind: "text".into(),
                        },
                    ],
                }),
                remove_secret_names: vec![],
                secrets,
            })
            .unwrap();

        let output = VaultMcp::new(vault.clone())
            .vault_items_list()
            .await
            .unwrap();
        assert!(output.contains("username"));
        assert!(output.contains("password"));
        let listed: serde_json::Value = serde_json::from_str(&output).unwrap();
        assert_eq!(listed["items"][0]["type"], "item");
        assert_eq!(listed["items"][0]["capabilities"], json!(["fill"]));
        assert!(output.contains("mcp-visible-user-marker"));
        assert!(!output.contains("mcp-hidden-password-marker"));

        vault.set_connection_enabled(saved.id, false).unwrap();
        let hidden = VaultMcp::new(vault).vault_items_list().await.unwrap();
        assert!(!hidden.contains("test login"));
        assert!(!hidden.contains("username"));
        assert!(!hidden.contains("password"));
    }
}
