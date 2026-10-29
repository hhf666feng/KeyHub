use anyhow::{Context, Result, bail};
use atomic_write_file::AtomicWriteFile;
use chrono::Utc;
use jsonc_parser::{ParseOptions, cst::CstInputValue, cst::CstRootNode, parse_to_serde_value};
use serde::Serialize;
use serde_json::Value as JsonValue;
use std::{
    env, fs,
    io::Write,
    path::{Path, PathBuf},
    process::Output,
    time::Duration,
};
use tokio::{process::Command, time::timeout};
use toml_edit::{Array, DocumentMut, Item, Table, value};

const CLIENT_IDS: [&str; 5] = ["codex", "claude-code", "cursor", "opencode", "openclaw"];
const STATUS_CLI_TIMEOUT: Duration = Duration::from_secs(3);
const ACTION_CLI_TIMEOUT: Duration = Duration::from_secs(20);
const OPENKEYLET_INSTRUCTION_START: &str = "<!-- OPENKEYLET MANAGED INSTRUCTION START -->";
const OPENKEYLET_INSTRUCTION_END: &str = "<!-- OPENKEYLET MANAGED INSTRUCTION END -->";
const LEGACY_INSTRUCTION_START: &str = "<!-- KRU MANAGED INSTRUCTION START -->";
const LEGACY_INSTRUCTION_END: &str = "<!-- KRU MANAGED INSTRUCTION END -->";
const KEYHUB_INSTRUCTION_START: &str = "<!-- KEYHUB MANAGED INSTRUCTION START -->";
const KEYHUB_INSTRUCTION_END: &str = "<!-- KEYHUB MANAGED INSTRUCTION END -->";
const SERVER_NAMES: [&str; 3] = ["keyhub", "openkeylet", "kru"];
const KEYHUB_INSTRUCTION_BLOCK: &str = r#"<!-- KEYHUB MANAGED INSTRUCTION START -->
When a task may require a login, credential, authenticated API, SSH host, VPS, or server, prefer KeyHub before asking the user to provide a secret. If the user names a KeyHub project and the intended action is clear, call that KeyHub action directly with the project name. When only one enabled project supports the action, its name may be omitted. Use `items_search` only to discover projects, modules, actions, or resolve ambiguity. When the user asks to create a credential, use `items_create` with empty secret slots and have the owner fill them in the KeyHub editor; do not request plaintext in chat. Follow KeyHub's MCP server instructions and never ask for hidden plaintext.
<!-- KEYHUB MANAGED INSTRUCTION END -->"#;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentClientStatus {
    pub client_id: String,
    pub display_name: String,
    pub detected: bool,
    pub state: String,
    pub install_path: String,
    pub config_path: String,
    pub can_register: bool,
    pub can_repair: bool,
    pub can_remove: bool,
    pub restart_required: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentActionResult {
    pub ok: bool,
    pub action: String,
    #[serde(flatten)]
    pub client: AgentClientStatus,
}

#[derive(Clone)]
pub struct AgentRegistry {
    executable: PathBuf,
    home: PathBuf,
    codex_home: PathBuf,
    opencode_config: PathBuf,
    opencode_config_explicit: bool,
    opencode_instruction_dir: PathBuf,
    openclaw_config: PathBuf,
    path_dirs: Vec<PathBuf>,
    app_data: PathBuf,
    local_app_data: PathBuf,
}

impl AgentRegistry {
    pub fn new(executable: PathBuf) -> Result<Self> {
        let home = dirs::home_dir().context("Unable to determine the user home directory")?;
        let path_dirs = env::split_paths(&env::var_os("PATH").unwrap_or_default()).collect();
        let app_data = env::var_os("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join("AppData").join("Roaming"));
        let local_app_data = env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join("AppData").join("Local"));
        let codex_home = resolve_codex_home(&home, env::var_os("CODEX_HOME").map(PathBuf::from));
        let opencode_config_directory = env_path("OPENCODE_CONFIG_DIR");
        let xdg_config_home = env_path("XDG_CONFIG_HOME");
        let (opencode_config, opencode_config_explicit) = resolve_opencode_config(
            &home,
            env_path("OPENCODE_CONFIG"),
            opencode_config_directory.clone(),
            xdg_config_home.clone(),
        );
        let opencode_instruction_dir = opencode_config_directory.unwrap_or_else(|| {
            xdg_config_home
                .unwrap_or_else(|| home.join(".config"))
                .join("opencode")
        });
        let openclaw_config = resolve_openclaw_config(&home, env_path("OPENCLAW_CONFIG_PATH"));
        Ok(Self {
            executable: normalize_path(executable),
            home,
            codex_home,
            opencode_config,
            opencode_config_explicit,
            opencode_instruction_dir,
            openclaw_config,
            path_dirs,
            app_data,
            local_app_data,
        })
    }

    pub fn refresh_managed_instructions(&self) {
        for client_id in CLIENT_IDS
            .into_iter()
            .filter(|client_id| supports_managed_instruction(client_id))
        {
            if let Err(error) = self.refresh_managed_instruction_if_present(client_id) {
                eprintln!("KeyHub: failed to refresh {client_id} managed instruction: {error:#}");
            }
        }
    }

    #[cfg(test)]
    fn isolated(executable: PathBuf, home: PathBuf, path_dirs: Vec<PathBuf>) -> Self {
        let (opencode_config, opencode_config_explicit) =
            resolve_opencode_config(&home, None, None, None);
        Self {
            executable: normalize_path(executable),
            app_data: home.join("AppData").join("Roaming"),
            local_app_data: home.join("AppData").join("Local"),
            codex_home: home.join(".codex"),
            opencode_config,
            opencode_config_explicit,
            opencode_instruction_dir: home.join(".config").join("opencode"),
            openclaw_config: resolve_openclaw_config(&home, None),
            home,
            path_dirs,
        }
    }

    pub async fn list(&self) -> Vec<AgentClientStatus> {
        // CLI-backed clients may need to start a Node process. Scan every client
        // concurrently so a slow or broken CLI cannot serially stall the settings page.
        let (codex, claude, cursor, opencode, openclaw) = tokio::join!(
            self.status(CLIENT_IDS[0]),
            self.status(CLIENT_IDS[1]),
            self.status(CLIENT_IDS[2]),
            self.status(CLIENT_IDS[3]),
            self.status(CLIENT_IDS[4]),
        );
        vec![codex, claude, cursor, opencode, openclaw]
    }

    pub async fn register(&self, client_ids: &[String]) -> Vec<AgentActionResult> {
        let mut results = Vec::new();
        for client_id in client_ids {
            results.push(self.mutate(client_id, "register").await);
        }
        results
    }

    pub async fn repair(&self, client_id: &str) -> AgentActionResult {
        self.mutate(client_id, "repair").await
    }

    pub async fn remove(&self, client_id: &str) -> AgentActionResult {
        self.mutate(client_id, "remove").await
    }

    async fn mutate(&self, client_id: &str, action: &str) -> AgentActionResult {
        if !CLIENT_IDS.contains(&client_id) {
            return self.error_status(client_id, action, "Unsupported Agent client");
        }
        let before = self.status(client_id).await;
        let allowed = match action {
            "register" => before.can_register,
            "repair" => before.can_repair,
            "remove" => before.can_remove,
            _ => false,
        };
        if !allowed {
            return AgentActionResult {
                ok: false,
                action: action.to_owned(),
                client: AgentClientStatus {
                    message: format!(
                        "Cannot perform this operation in the current state{}",
                        action_label(action)
                    ),
                    ..before
                },
            };
        }

        let result = if action == "remove" {
            self.mutate_global_instruction(client_id, action)
        } else {
            Ok(())
        };
        let result = match result {
            Ok(()) => self.mutate_mcp_client(client_id, action).await,
            Err(error) => Err(error),
        };
        let result = if result.is_ok() && action != "remove" {
            self.mutate_global_instruction(client_id, action)
        } else {
            result
        };
        match result {
            Ok(()) => {
                let mut after = self.status(client_id).await;
                after.restart_required = true;
                AgentActionResult {
                    ok: true,
                    action: action.to_owned(),
                    client: after,
                }
            }
            Err(error) => {
                let mut after = self.status(client_id).await;
                after.message = error.to_string();
                AgentActionResult {
                    ok: false,
                    action: action.to_owned(),
                    client: after,
                }
            }
        }
    }

    async fn mutate_mcp_client(&self, client_id: &str, action: &str) -> Result<()> {
        match client_id {
            "codex" => self.mutate_codex(action),
            "cursor" | "opencode" => self.mutate_json_client(client_id, action),
            "claude-code" | "openclaw" => self.mutate_cli_client(client_id, action).await,
            _ => unreachable!(),
        }
    }

    async fn status(&self, client_id: &str) -> AgentClientStatus {
        let display_name = display_name(client_id).to_owned();
        let config_path = self.config_path(client_id);
        let executable = self.find_client_executable(client_id);
        let detected = config_path.is_file()
            || executable.is_some()
            || self.desktop_install_exists(client_id)
            || (client_id == "opencode" && self.opencode_config_target_exists());
        let install_path = executable
            .as_ref()
            .map(|path| path.to_string_lossy().into_owned())
            .unwrap_or_default();
        let mut status = AgentClientStatus {
            client_id: client_id.to_owned(),
            display_name,
            detected,
            state: if detected { "available" } else { "notDetected" }.to_owned(),
            install_path,
            config_path: config_path.to_string_lossy().into_owned(),
            can_register: detected,
            can_repair: false,
            can_remove: false,
            restart_required: false,
            message: if detected {
                "Can connect to KeyHub".to_owned()
            } else {
                "Not detected on this device".to_owned()
            },
        };
        if !detected {
            return status;
        }

        let inspected = match client_id {
            "codex" => self.inspect_codex(),
            "cursor" | "opencode" => self.inspect_json_client(client_id),
            "claude-code" | "openclaw" => {
                let Some(executable) = executable else {
                    status.state = "error".to_owned();
                    status.can_register = false;
                    status.message =
                        "Configuration detected, but no callable CLI was found".to_owned();
                    return status;
                };
                self.inspect_cli_client(client_id, &executable).await
            }
            _ => Ok(EntryState::Available),
        };
        match inspected {
            Ok(EntryState::Registered) if supports_managed_instruction(client_id) => {
                let refreshed = match self.refresh_managed_instruction_if_present(client_id) {
                    Ok(refreshed) => refreshed,
                    Err(error) => {
                        status.state = "error".to_owned();
                        status.can_register = false;
                        status.message = error.to_string();
                        return status;
                    }
                };
                match self.inspect_global_instruction(client_id) {
                    Ok(InstructionState::Current) => {
                        apply_entry_state(&mut status, EntryState::Registered);
                        if refreshed {
                            status.restart_required = true;
                            status.message =
                                "KeyHub connected; managed rules were updated automatically and will take effect after restarting the Agent"
                                    .to_owned();
                        }
                    }
                    Ok(InstructionState::Missing) => {
                        apply_entry_state(&mut status, EntryState::Stale)
                    }
                    Ok(InstructionState::Conflict) => {
                        apply_entry_state(&mut status, EntryState::Conflict)
                    }
                    Err(error) => {
                        status.state = "error".to_owned();
                        status.can_register = false;
                        status.message = error.to_string();
                    }
                }
            }
            Ok(entry) => apply_entry_state(&mut status, entry),
            Err(error) => {
                status.state = "error".to_owned();
                status.can_register = false;
                status.message = error.to_string();
            }
        }
        if app_translocated(&self.executable) {
            status.state = "pathChanged".to_owned();
            status.can_register = false;
            status.can_repair = false;
            status.message =
                "KeyHub is running from a temporary quarantine path on macOS; move KeyHub.app to Applications before connecting"
                    .to_owned();
        }
        status
    }

    fn refresh_managed_instruction_if_present(&self, client_id: &str) -> Result<bool> {
        let path = self.active_instruction_path(client_id)?;
        if !path.is_file() {
            return Ok(false);
        }
        let text = fs::read_to_string(&path)
            .with_context(|| format!("Unable to read Agent global rules {}", path.display()))?;
        // Legacy brands are migrated only by an explicit connect/repair action.
        if has_legacy_instruction(&text)
            || (!text.contains(KEYHUB_INSTRUCTION_START) && !text.contains(KEYHUB_INSTRUCTION_END))
            || text.contains(KEYHUB_INSTRUCTION_BLOCK)
        {
            return Ok(false);
        }
        upsert_managed_instruction(&path, client_id == "claude-code")?;
        Ok(true)
    }

    fn inspect_global_instruction(&self, client_id: &str) -> Result<InstructionState> {
        let path = self.active_instruction_path(client_id)?;
        if !path.is_file() {
            return Ok(InstructionState::Missing);
        }
        let text = fs::read_to_string(&path)
            .with_context(|| format!("Unable to read Agent global rules {}", path.display()))?;
        if text.contains(KEYHUB_INSTRUCTION_BLOCK) && !has_legacy_instruction(&text) {
            return Ok(InstructionState::Current);
        }
        if client_id == "claude-code" && !text.trim().is_empty() && !has_managed_instruction(&text)
        {
            return Ok(InstructionState::Conflict);
        }
        Ok(InstructionState::Missing)
    }

    fn mutate_global_instruction(&self, client_id: &str, action: &str) -> Result<()> {
        if !supports_managed_instruction(client_id) {
            return Ok(());
        }
        if action == "remove" {
            for path in self.instruction_paths(client_id)? {
                remove_managed_instruction(&path, client_id == "claude-code")?;
            }
            return Ok(());
        }

        let path = self.active_instruction_path(client_id)?;
        upsert_managed_instruction(&path, client_id == "claude-code")
    }

    fn active_instruction_path(&self, client_id: &str) -> Result<PathBuf> {
        match client_id {
            "codex" => {
                let override_path = self.codex_home.join("AGENTS.override.md");
                let override_text = read_or(&override_path, "")?;
                if override_text.trim().is_empty() {
                    Ok(self.codex_home.join("AGENTS.md"))
                } else {
                    Ok(override_path)
                }
            }
            "claude-code" => {
                let rules = self.home.join(".claude").join("rules");
                let current = rules.join("keyhub.md");
                if current.is_file() {
                    return Ok(current);
                }
                for name in ["openkeylet.md", "kru.md"] {
                    let legacy = rules.join(name);
                    if legacy.is_file() && has_managed_instruction(&read_or(&legacy, "")?) {
                        return Ok(legacy);
                    }
                }
                Ok(current)
            }
            "opencode" => Ok(self.opencode_instruction_dir.join("AGENTS.md")),
            _ => bail!("This Agent has no global rules entry point that can be safely maintained"),
        }
    }

    fn instruction_paths(&self, client_id: &str) -> Result<Vec<PathBuf>> {
        if client_id == "claude-code" {
            let rules = self.home.join(".claude").join("rules");
            return Ok(vec![
                rules.join("keyhub.md"),
                rules.join("openkeylet.md"),
                rules.join("kru.md"),
            ]);
        }
        if client_id == "codex" {
            return Ok(vec![
                self.codex_home.join("AGENTS.md"),
                self.codex_home.join("AGENTS.override.md"),
            ]);
        }
        Ok(vec![self.active_instruction_path(client_id)?])
    }

    fn inspect_codex(&self) -> Result<EntryState> {
        let path = self.config_path("codex");
        if !path.is_file() {
            return Ok(EntryState::Available);
        }
        let text = fs::read_to_string(&path).context("Unable to read Codex configuration")?;
        let document = text
            .parse::<DocumentMut>()
            .context("Invalid Codex TOML configuration")?;
        let servers = document.get("mcp_servers").and_then(Item::as_table_like);
        let has_legacy = SERVER_NAMES[1..].iter().any(|name| {
            servers
                .and_then(|servers| servers.get(name))
                .is_some_and(|entry| owned_toml_entry(entry, &self.executable))
        });
        let Some(entry) = servers.and_then(|servers| servers.get("keyhub")) else {
            return Ok(with_legacy_state(EntryState::Available, has_legacy));
        };
        let Some(entry) = entry.as_table_like() else {
            return Ok(EntryState::Conflict);
        };
        let command = entry
            .get("command")
            .and_then(Item::as_str)
            .unwrap_or_default();
        let args = entry
            .get("args")
            .and_then(Item::as_array)
            .map(toml_array_strings)
            .unwrap_or_default();
        Ok(with_legacy_state(
            classify_command(command, &args, &self.executable),
            has_legacy,
        ))
    }

    fn inspect_json_client(&self, client_id: &str) -> Result<EntryState> {
        let path = self.config_path(client_id);
        if !path.is_file() {
            return Ok(EntryState::Available);
        }
        let text = fs::read_to_string(&path).context("Unable to read Agent JSON configuration")?;
        let document: JsonValue = parse_to_serde_value(&text, &ParseOptions::default())
            .context("Invalid Agent JSON/JSONC configuration")?;
        let has_legacy = legacy_json_paths(client_id).iter().any(|path| {
            document
                .pointer(path)
                .is_some_and(|entry| owned_json_entry(entry, &self.executable))
        });
        if client_id == "cursor" {
            let Some(entry) = document.pointer("/mcpServers/keyhub") else {
                return Ok(if has_legacy {
                    EntryState::Stale
                } else {
                    EntryState::Available
                });
            };
            let command = entry
                .get("command")
                .and_then(JsonValue::as_str)
                .unwrap_or_default()
                .to_owned();
            let args = json_array_strings(entry.get("args"));
            return Ok(with_legacy_state(
                classify_command(&command, &args, &self.executable),
                has_legacy,
            ));
        }

        let current = document.pointer("/mcp/servers/keyhub");
        let legacy = document.pointer("/mcp/keyhub");
        let classify = |entry: &JsonValue| {
            let command = json_array_strings(entry.get("command"));
            (
                command.first().cloned().unwrap_or_default(),
                command.iter().skip(1).cloned().collect::<Vec<_>>(),
            )
        };
        let state: Result<EntryState> = match (current, legacy) {
            (None, None) => Ok(EntryState::Available),
            (Some(entry), None) => {
                let (command, args) = classify(entry);
                Ok(classify_command(&command, &args, &self.executable))
            }
            (None, Some(entry)) => {
                let (command, args) = classify(entry);
                let state = classify_command(&command, &args, &self.executable);
                Ok(state)
            }
            (Some(current), Some(legacy)) => {
                let (current_command, current_args) = classify(current);
                let (legacy_command, legacy_args) = classify(legacy);
                let current_state =
                    classify_command(&current_command, &current_args, &self.executable);
                let legacy_state =
                    classify_command(&legacy_command, &legacy_args, &self.executable);
                Ok(
                    if current_state == EntryState::Conflict || legacy_state == EntryState::Conflict
                    {
                        EntryState::Conflict
                    } else {
                        EntryState::Stale
                    },
                )
            }
        };
        Ok(with_legacy_state(state?, has_legacy))
    }

    async fn inspect_cli_client(&self, client_id: &str, executable: &Path) -> Result<EntryState> {
        let current = self
            .inspect_named_cli_entry(client_id, executable, "keyhub")
            .await?;
        let mut has_legacy = false;
        for name in &SERVER_NAMES[1..] {
            has_legacy |= matches!(
                self.inspect_named_cli_entry(client_id, executable, name)
                    .await?,
                Some(EntryState::Registered | EntryState::Stale)
            );
        }
        Ok(with_legacy_state(
            current.unwrap_or(EntryState::Available),
            has_legacy,
        ))
    }

    async fn inspect_named_cli_entry(
        &self,
        client_id: &str,
        executable: &Path,
        name: &str,
    ) -> Result<Option<EntryState>> {
        let args = if client_id == "claude-code" {
            vec!["mcp", "get", name]
        } else {
            vec!["mcp", "show", name, "--json"]
        };
        let output = self.run_cli_status(executable, &args).await?;
        let text = output_text(&output);
        if !output.status.success() {
            if is_missing_entry(&text) {
                return Ok(None);
            }
            bail!("{}", clean_process_error(&text));
        }
        if text_matches(&text, &self.executable) {
            Ok(Some(EntryState::Registered))
        } else if text_has_openkeylet_command(&text) {
            Ok(Some(EntryState::Stale))
        } else {
            Ok(Some(EntryState::Conflict))
        }
    }

    fn mutate_codex(&self, action: &str) -> Result<()> {
        let path = self.config_path("codex");
        let original = read_or(&path, "")?;
        let mut document = original
            .parse::<DocumentMut>()
            .context("Invalid Codex TOML configuration; no changes were made")?;
        if action != "repair"
            && action != "remove"
            && document
                .get("mcp_servers")
                .and_then(Item::as_table_like)
                .and_then(|servers| servers.get("keyhub"))
                .is_some_and(|entry| !owned_toml_entry(entry, &self.executable))
        {
            bail!("A KeyHub configuration with different contents already exists; use Repair");
        }
        let previous_entry = document
            .get("mcp_servers")
            .and_then(Item::as_table_like)
            .and_then(|servers| {
                SERVER_NAMES
                    .iter()
                    .filter_map(|name| servers.get(name))
                    .find(|entry| owned_toml_entry(entry, &self.executable))
            })
            .cloned();
        if action == "repair" && path.is_file() {
            backup_config(&path)?;
        }
        if let Some(servers) = document
            .get_mut("mcp_servers")
            .and_then(Item::as_table_like_mut)
        {
            for name in SERVER_NAMES {
                if (action == "remove" || name != "keyhub")
                    && servers
                        .get(name)
                        .is_some_and(|entry| owned_toml_entry(entry, &self.executable))
                {
                    servers.remove(name);
                }
            }
        }
        if action != "remove" {
            if !document.contains_key("mcp_servers") {
                document["mcp_servers"] = Item::Table(Table::new());
            }
            let servers = document["mcp_servers"]
                .as_table_like_mut()
                .context("Codex mcp_servers is not a table")?;
            let mut entry = previous_entry.unwrap_or_else(|| Item::Table(Table::new()));
            let table = entry
                .as_table_like_mut()
                .context("MCP configuration is not a table")?;
            set_toml_field(
                table,
                "command",
                value(self.executable.to_string_lossy().into_owned()),
            );
            let mut args = Array::new();
            args.push("mcp");
            args.push("stdio");
            set_toml_field(table, "args", value(args));
            servers.insert("keyhub", entry);
        }
        write_atomic_checked(&path, &original, &document.to_string())
    }

    fn mutate_json_client(&self, client_id: &str, action: &str) -> Result<()> {
        let path = self.config_path(client_id);
        let original = read_or(&path, "{}\n")?;
        let root = CstRootNode::parse(&original, &ParseOptions::default())
            .context("Invalid Agent JSON/JSONC configuration; no changes were made")?;
        let root_object = root
            .object_value()
            .context("Agent configuration is not an object")?;
        let original_value: JsonValue =
            parse_to_serde_value(&original, &ParseOptions::default())
                .context("Invalid Agent JSON/JSONC configuration; no changes were made")?;
        let string_command = matches!(client_id, "cursor" | "claude-code");
        let current_paths: &[&str] = if string_command {
            &["/mcpServers/keyhub"]
        } else {
            &["/mcp/servers/keyhub", "/mcp/keyhub"]
        };
        if action != "remove"
            && client_id == "opencode"
            && current_paths
                .iter()
                .all(|pointer| original_value.pointer(pointer).is_some())
            && current_paths.iter().any(|pointer| {
                original_value
                    .pointer(pointer)
                    .is_some_and(|entry| !owned_json_entry(entry, &self.executable))
            })
        {
            bail!(
                "OpenCode has keyhub entries at both /mcp/servers/keyhub and /mcp/keyhub, including an unrelated server; resolve this canonical-name conflict before repairing. No changes were made"
            );
        }
        let paths: Vec<_> = current_paths
            .iter()
            .chain(legacy_json_paths(client_id))
            .copied()
            .collect();
        let source = paths.iter().copied().find(|pointer| {
            original_value
                .pointer(pointer)
                .is_some_and(|entry| owned_json_entry(entry, &self.executable))
        });
        let string_command = string_command
            || (client_id == "openclaw"
                && source
                    .and_then(|pointer| original_value.pointer(pointer))
                    .and_then(|entry| entry.get("command"))
                    .is_some_and(JsonValue::is_string));
        if action == "repair" && path.is_file() {
            backup_config(&path)?;
        }
        if action == "remove" {
            for pointer in paths {
                if original_value
                    .pointer(pointer)
                    .is_some_and(|entry| owned_json_entry(entry, &self.executable))
                    && let Some(entry) = json_cst_property(&root_object, pointer)
                {
                    entry.remove();
                }
            }
            return write_atomic_checked(&path, &original, &root.to_string());
        }

        // Rename the owned property in place so its comments, environment, and
        // disabled state survive. Keep an existing OpenCode V1/V2 layout.
        let target = current_paths
            .iter()
            .copied()
            .find(|pointer| original_value.pointer(pointer).is_some())
            .or(source)
            .unwrap_or_else(|| {
                if string_command {
                    "/mcpServers/keyhub"
                } else if original_value
                    .pointer("/mcp/servers")
                    .is_some_and(JsonValue::is_object)
                {
                    "/mcp/servers/keyhub"
                } else {
                    "/mcp/keyhub"
                }
            });
        let (container_path, _) = target
            .rsplit_once('/')
            .context("Invalid MCP property path")?;
        let container = json_cst_container(&root_object, container_path)?;
        if let Some(current) = container.get("keyhub") {
            let canonical_pointer = format!("{container_path}/keyhub");
            if !original_value
                .pointer(&canonical_pointer)
                .is_some_and(|entry| owned_json_entry(entry, &self.executable))
            {
                if action != "repair" {
                    bail!(
                        "A KeyHub configuration with different contents already exists; use Repair"
                    );
                }
                current.set_value(
                    source
                        .and_then(|pointer| original_value.pointer(pointer))
                        .map(json_to_cst)
                        .unwrap_or_else(|| CstInputValue::Object(Vec::new())),
                );
            }
        } else if let Some(source) = source.filter(|source| {
            source.rsplit_once('/').map(|(parent, _)| parent) == Some(container_path)
        }) {
            let property =
                json_cst_property(&root_object, source).context("MCP property disappeared")?;
            match property
                .name()
                .context("MCP property is missing its name")?
            {
                jsonc_parser::cst::ObjectPropName::String(name) => {
                    name.set_raw_value("\"keyhub\"".to_owned())
                }
                jsonc_parser::cst::ObjectPropName::Word(name) => {
                    name.set_raw_value("keyhub".to_owned())
                }
            }
        } else {
            container.append(
                "keyhub",
                source
                    .and_then(|pointer| original_value.pointer(pointer))
                    .map(json_to_cst)
                    .unwrap_or_else(|| CstInputValue::Object(Vec::new())),
            );
        }
        let entry = container
            .object_value("keyhub")
            .context("MCP configuration is not an object")?;
        if string_command {
            set_json_field(
                &entry,
                "command",
                self.executable.to_string_lossy().into_owned().into(),
            );
            set_json_field(&entry, "args", vec!["mcp", "stdio"].into());
        } else {
            if client_id == "opencode" {
                set_json_field(&entry, "type", "local".into());
            }
            set_json_field(
                &entry,
                "command",
                vec![
                    self.executable.to_string_lossy().into_owned(),
                    "mcp".to_owned(),
                    "stdio".to_owned(),
                ]
                .into(),
            );
            if client_id == "opencode" && container_path == "/mcp" && entry.get("enabled").is_none()
            {
                entry.append("enabled", true.into());
            }
        }
        let canonical_pointer = format!("{container_path}/keyhub");
        for pointer in paths {
            if pointer != canonical_pointer
                && original_value
                    .pointer(pointer)
                    .is_some_and(|entry| owned_json_entry(entry, &self.executable))
                && let Some(entry) = json_cst_property(&root_object, pointer)
            {
                entry.remove();
            }
        }
        if client_id == "claude-code"
            && let Some(disabled) = root_object.array_value("disabledMcpServers")
        {
            for node in disabled.elements() {
                if let Some(name) = node.as_string_lit()
                    && let Ok(alias) = name.decoded_value()
                    && SERVER_NAMES[1..].contains(&alias.as_str())
                    && original_value
                        .pointer(&format!("/mcpServers/{alias}"))
                        .is_some_and(|entry| owned_json_entry(entry, &self.executable))
                {
                    name.set_raw_value("\"keyhub\"".to_owned());
                }
            }
        }
        write_atomic_checked(&path, &original, &root.to_string())
    }

    async fn mutate_cli_client(&self, client_id: &str, action: &str) -> Result<()> {
        let executable = self
            .find_client_executable(client_id)
            .context("Agent CLI not found")?;
        // When the CLI's user-scope config is a known shape, edit its CST rather
        // than remove/add: CLI recreation can lose comments and disabled flags.
        let config = self.config_path(client_id);
        if config.is_file() {
            let text = fs::read_to_string(&config).context("Unable to read Agent configuration")?;
            let value: JsonValue = parse_to_serde_value(&text, &ParseOptions::default())
                .context("Invalid Agent JSON/JSONC configuration; no changes were made")?;
            let container = if client_id == "claude-code" {
                value.get("mcpServers")
            } else {
                value.pointer("/mcp/servers").or_else(|| value.get("mcp"))
            };
            if container.is_some_and(JsonValue::is_object) {
                return self.mutate_json_client(client_id, action);
            }
        }
        let current = self
            .inspect_named_cli_entry(client_id, &executable, "keyhub")
            .await?;
        if current == Some(EntryState::Conflict) && action != "repair" {
            bail!("A KeyHub configuration with different contents already exists; use Repair");
        }
        if action == "repair" && self.config_path(client_id).is_file() {
            backup_config(&self.config_path(client_id))?;
        }
        if action == "remove" || (action == "repair" && current.is_some()) {
            if current.is_some() {
                self.remove_named_cli_entry(client_id, &executable, "keyhub")
                    .await?;
            }
            if action == "remove" {
                return self.remove_legacy_cli_entry(client_id, &executable).await;
            }
        }
        let exe = self.executable.to_string_lossy().into_owned();
        let args = if client_id == "claude-code" {
            vec![
                "mcp".to_owned(),
                "add".to_owned(),
                "--scope".to_owned(),
                "user".to_owned(),
                "--transport".to_owned(),
                "stdio".to_owned(),
                "keyhub".to_owned(),
                "--".to_owned(),
                exe,
                "mcp".to_owned(),
                "stdio".to_owned(),
            ]
        } else {
            vec![
                "mcp".to_owned(),
                "add".to_owned(),
                "keyhub".to_owned(),
                "--command".to_owned(),
                exe,
                "--arg".to_owned(),
                "mcp".to_owned(),
                "--arg".to_owned(),
                "stdio".to_owned(),
            ]
        };
        let refs: Vec<&str> = args.iter().map(String::as_str).collect();
        let output = self.run_cli_action(&executable, &refs).await?;
        if !output.status.success() {
            bail!("{}", clean_process_error(&output_text(&output)));
        }
        self.remove_legacy_cli_entry(client_id, &executable).await
    }

    async fn remove_legacy_cli_entry(&self, client_id: &str, executable: &Path) -> Result<()> {
        for name in &SERVER_NAMES[1..] {
            if matches!(
                self.inspect_named_cli_entry(client_id, executable, name)
                    .await?,
                Some(EntryState::Registered | EntryState::Stale)
            ) {
                self.remove_named_cli_entry(client_id, executable, name)
                    .await?;
            }
        }
        Ok(())
    }

    async fn remove_named_cli_entry(
        &self,
        client_id: &str,
        executable: &Path,
        name: &str,
    ) -> Result<()> {
        let args = if client_id == "claude-code" {
            vec!["mcp", "remove", "--scope", "user", name]
        } else {
            vec!["mcp", "unset", name]
        };
        let output = self.run_cli_action(executable, &args).await?;
        if !(output.status.success() || is_missing_entry(&output_text(&output))) {
            bail!("{}", clean_process_error(&output_text(&output)));
        }
        Ok(())
    }

    async fn run_cli_status(&self, executable: &Path, args: &[&str]) -> Result<Output> {
        self.run_cli(
            executable,
            args,
            STATUS_CLI_TIMEOUT,
            "Agent CLI status check timed out",
        )
        .await
    }

    async fn run_cli_action(&self, executable: &Path, args: &[&str]) -> Result<Output> {
        self.run_cli(
            executable,
            args,
            ACTION_CLI_TIMEOUT,
            "Agent CLI operation timed out",
        )
        .await
    }

    async fn run_cli(
        &self,
        executable: &Path,
        args: &[&str],
        deadline: Duration,
        timeout_message: &str,
    ) -> Result<Output> {
        let (program, prefix) = self.resolve_program(executable)?;
        let mut command = Command::new(program);
        command.args(prefix).args(args).kill_on_drop(true);
        #[cfg(windows)]
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        timeout(deadline, command.output())
            .await
            .with_context(|| timeout_message.to_owned())?
            .context("Unable to start Agent CLI")
    }

    fn resolve_program(&self, executable: &Path) -> Result<(PathBuf, Vec<String>)> {
        if !cfg!(windows)
            || !executable
                .extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("cmd"))
        {
            return Ok((executable.to_path_buf(), Vec::new()));
        }
        let text = fs::read_to_string(executable).context("Unable to read npm command launcher")?;
        let pattern = regex::Regex::new(r#"(?i)%dp0%\\([^\"\r\n]+\.(?:c?js|mjs))"#)?;
        let relative = pattern
            .captures(&text)
            .and_then(|captures| captures.get(1))
            .map(|value| value.as_str().replace('\\', "/"))
            .context("This .cmd is not a supported standard npm launcher")?;
        let root = executable
            .parent()
            .context("Invalid npm launcher directory")?;
        let target = normalize_path(root.join(relative));
        let modules = normalize_path(root.join("node_modules"));
        if !target.starts_with(&modules) || !target.is_file() {
            bail!("npm launcher target is not in a trusted node_modules");
        }
        let node = self
            .find_named_command(&["node"])
            .context("node.exe not found; unable to run the npm Agent CLI safely")?;
        Ok((node, vec![node_script_argument_path(&target)]))
    }

    fn config_path(&self, client_id: &str) -> PathBuf {
        match client_id {
            "codex" => self.codex_home.join("config.toml"),
            "claude-code" => self.home.join(".claude.json"),
            "cursor" => self.home.join(".cursor").join("mcp.json"),
            "opencode" => self.opencode_config_path(),
            "openclaw" => self.openclaw_config.clone(),
            _ => self.home.join(".openkeylet").join("unsupported"),
        }
    }

    fn opencode_config_path(&self) -> PathBuf {
        if !self.opencode_config_explicit
            && self.opencode_config.file_name().is_some_and(|name| {
                name.eq_ignore_ascii_case("opencode.jsonc") && !self.opencode_config.is_file()
            })
            && let Some(directory) = self.opencode_config.parent()
        {
            return preferred_json_config(directory);
        }
        self.opencode_config.clone()
    }

    fn opencode_config_target_exists(&self) -> bool {
        self.opencode_config_explicit
            || self
                .opencode_config
                .parent()
                .is_some_and(|directory| directory.is_dir())
    }

    fn find_client_executable(&self, client_id: &str) -> Option<PathBuf> {
        let names: &[&str] = match client_id {
            "claude-code" => &["claude"],
            "cursor" => &["cursor-agent", "cursor"],
            _ => &[client_id],
        };
        self.find_named_command(names)
    }

    fn find_named_command(&self, names: &[&str]) -> Option<PathBuf> {
        let mut directories = vec![
            self.home.join(".local").join("bin"),
            self.home.join("bin"),
            self.home.join(".bun").join("bin"),
            self.home.join(".volta").join("bin"),
            self.home.join(".local").join("share").join("pnpm"),
            self.home.join(".codex").join("bin"),
            self.home.join(".opencode").join("bin"),
            self.home.join(".openclaw").join("bin"),
            self.app_data.join("npm"),
            self.local_app_data.join("pnpm"),
        ];
        for variable in ["PNPM_HOME", "VOLTA_HOME", "BUN_INSTALL"] {
            if let Some(directory) = env_path(variable) {
                directories.push(if variable == "PNPM_HOME" {
                    directory
                } else {
                    directory.join("bin")
                });
            }
        }
        if cfg!(target_os = "macos") {
            directories.extend([
                self.home.join("Library").join("pnpm"),
                self.home.join(".npm-global").join("bin"),
                PathBuf::from("/opt/homebrew/bin"),
                PathBuf::from("/usr/local/bin"),
                PathBuf::from("/usr/bin"),
            ]);
        } else if !cfg!(windows) {
            directories.extend([
                self.home.join(".npm-global").join("bin"),
                PathBuf::from("/usr/local/bin"),
                PathBuf::from("/usr/bin"),
            ]);
        }
        directories.extend(self.path_dirs.iter().cloned());
        directories.dedup();
        for directory in directories {
            for name in names {
                let candidates = if cfg!(windows) {
                    vec![
                        directory.join(format!("{name}.exe")),
                        directory.join(format!("{name}.cmd")),
                    ]
                } else {
                    vec![directory.join(name)]
                };
                if let Some(found) = candidates.into_iter().find(|path| is_runnable_file(path)) {
                    return Some(normalize_path(found));
                }
            }
        }
        None
    }

    fn desktop_install_exists(&self, client_id: &str) -> bool {
        let candidates: Vec<PathBuf> = match (client_id, env::consts::OS) {
            ("codex", "windows") => vec![
                self.local_app_data
                    .join("Programs")
                    .join("Codex")
                    .join("Codex.exe"),
                self.local_app_data.join("Codex").join("Codex.exe"),
            ],
            ("cursor", "windows") => vec![
                self.local_app_data
                    .join("Programs")
                    .join("cursor")
                    .join("Cursor.exe"),
            ],
            ("opencode", "windows") => vec![
                self.local_app_data
                    .join("Programs")
                    .join("OpenCode")
                    .join("OpenCode.exe"),
                self.local_app_data
                    .join("Programs")
                    .join("opencode")
                    .join("OpenCode.exe"),
            ],
            ("codex", "macos") => vec![
                PathBuf::from("/Applications/Codex.app"),
                self.home.join("Applications/Codex.app"),
            ],
            ("cursor", "macos") => vec![
                PathBuf::from("/Applications/Cursor.app"),
                self.home.join("Applications/Cursor.app"),
            ],
            ("opencode", "macos") => vec![
                PathBuf::from("/Applications/OpenCode.app"),
                self.home.join("Applications/OpenCode.app"),
            ],
            _ => Vec::new(),
        };
        candidates.into_iter().any(|path| path.exists())
    }

    fn error_status(&self, client_id: &str, action: &str, message: &str) -> AgentActionResult {
        AgentActionResult {
            ok: false,
            action: action.to_owned(),
            client: AgentClientStatus {
                client_id: client_id.to_owned(),
                display_name: display_name(client_id).to_owned(),
                detected: false,
                state: "error".to_owned(),
                install_path: String::new(),
                config_path: String::new(),
                can_register: false,
                can_repair: false,
                can_remove: false,
                restart_required: false,
                message: message.to_owned(),
            },
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum EntryState {
    Available,
    Registered,
    Stale,
    Conflict,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum InstructionState {
    Current,
    Missing,
    Conflict,
}

fn supports_managed_instruction(client_id: &str) -> bool {
    matches!(client_id, "codex" | "claude-code" | "opencode")
}

fn apply_entry_state(status: &mut AgentClientStatus, state: EntryState) {
    match state {
        EntryState::Available => {
            status.state = "available".to_owned();
            status.can_register = true;
            status.message = "Can connect to KeyHub".to_owned();
        }
        EntryState::Registered => {
            status.state = "registered".to_owned();
            status.can_register = false;
            status.can_remove = true;
            status.message = "KeyHub connected".to_owned();
        }
        EntryState::Stale => {
            status.state = "stale".to_owned();
            status.can_register = false;
            status.can_repair = true;
            status.can_remove = true;
            status.message = "KeyHub path, arguments, or global rules need updating".to_owned();
        }
        EntryState::Conflict => {
            status.state = "conflict".to_owned();
            status.can_register = false;
            status.can_repair = true;
            status.message =
                "A KeyHub configuration with the same name already exists, but its contents differ"
                    .to_owned();
        }
    }
}

fn with_legacy_state(state: EntryState, has_legacy: bool) -> EntryState {
    if has_legacy && state != EntryState::Conflict {
        EntryState::Stale
    } else {
        state
    }
}

fn owned_toml_entry(entry: &Item, executable: &Path) -> bool {
    entry
        .as_table_like()
        .and_then(|entry| entry.get("command"))
        .and_then(Item::as_str)
        .is_some_and(|command| {
            is_openkeylet_command(command) || same_path(Path::new(command), executable)
        })
}

fn owned_json_entry(entry: &JsonValue, executable: &Path) -> bool {
    entry
        .get("command")
        .and_then(|command| {
            command
                .as_str()
                .or_else(|| command.as_array()?.first()?.as_str())
        })
        .is_some_and(|command| {
            is_openkeylet_command(command) || same_path(Path::new(command), executable)
        })
}

fn legacy_json_paths(client_id: &str) -> &'static [&'static str] {
    if matches!(client_id, "cursor" | "claude-code") {
        &["/mcpServers/openkeylet", "/mcpServers/kru"]
    } else {
        &[
            "/mcp/servers/openkeylet",
            "/mcp/openkeylet",
            "/mcp/servers/kru",
            "/mcp/kru",
        ]
    }
}

fn json_to_cst(value: &JsonValue) -> CstInputValue {
    match value {
        JsonValue::Null => CstInputValue::Null,
        JsonValue::Bool(value) => CstInputValue::Bool(*value),
        JsonValue::Number(value) => CstInputValue::Number(value.to_string()),
        JsonValue::String(value) => CstInputValue::String(value.clone()),
        JsonValue::Array(values) => CstInputValue::Array(values.iter().map(json_to_cst).collect()),
        JsonValue::Object(values) => CstInputValue::Object(
            values
                .iter()
                .map(|(key, value)| (key.clone(), json_to_cst(value)))
                .collect(),
        ),
    }
}

fn json_cst_property(
    root: &jsonc_parser::cst::CstObject,
    pointer: &str,
) -> Option<jsonc_parser::cst::CstObjectProp> {
    let (container, name) = pointer.rsplit_once('/')?;
    let mut object = root.clone();
    for name in container.split('/').filter(|name| !name.is_empty()) {
        object = object.object_value(name)?;
    }
    object.get(name)
}

fn json_cst_container(
    root: &jsonc_parser::cst::CstObject,
    pointer: &str,
) -> Result<jsonc_parser::cst::CstObject> {
    let mut object = root.clone();
    for name in pointer.split('/').filter(|name| !name.is_empty()) {
        object = object
            .object_value_or_create(name)
            .context("MCP container is not an object")?;
    }
    Ok(object)
}

fn set_json_field(object: &jsonc_parser::cst::CstObject, name: &str, value: CstInputValue) {
    if let Some(property) = object.get(name) {
        property.set_value(value);
    } else {
        object.append(name, value);
    }
}

fn set_toml_field(table: &mut dyn toml_edit::TableLike, name: &str, mut value: Item) {
    if let Some(previous) = table.get(name).and_then(Item::as_value)
        && let Some(value) = value.as_value_mut()
    {
        *value.decor_mut() = previous.decor().clone();
    }
    if let Some(previous) = table.get_mut(name) {
        *previous = value;
    } else {
        table.insert(name, value);
    }
}

fn classify_command(command: &str, args: &[String], executable: &Path) -> EntryState {
    if same_path(Path::new(command), executable) && args == ["mcp", "stdio"] {
        EntryState::Registered
    } else if is_openkeylet_command(command) {
        EntryState::Stale
    } else {
        EntryState::Conflict
    }
}

fn cli_command(text: &str) -> Option<(String, Vec<String>)> {
    if let Ok(document) = parse_to_serde_value::<JsonValue>(text.trim(), &ParseOptions::default()) {
        let entry = if document.get("command").is_some() {
            &document
        } else {
            document.get("server").or_else(|| document.get("config"))?
        };
        let command = entry.get("command")?;
        return if let Some(command) = command.as_str() {
            Some((command.to_owned(), json_array_strings(entry.get("args"))))
        } else {
            let command = json_array_strings(Some(command));
            Some((
                command.first()?.clone(),
                command.into_iter().skip(1).collect(),
            ))
        };
    }
    let command =
        regex::Regex::new(r"(?im)^\s*command\s*:\s*([^\r\n]+)").expect("static command regex");
    let args = regex::Regex::new(r"(?im)^\s*args\s*:\s*([^\r\n]+)").expect("static args regex");
    let command = command.captures(text)?[1]
        .trim()
        .trim_matches(['\'', '"'])
        .to_owned();
    let args = args
        .captures(text)
        .map(|captures| captures[1].split_whitespace().map(str::to_owned).collect())
        .unwrap_or_default();
    Some((command, args))
}

fn text_matches(text: &str, executable: &Path) -> bool {
    let Some((command, args)) = cli_command(text) else {
        return false;
    };
    let exact = executable.to_string_lossy();
    let portable = exact.strip_prefix(r"\\?\").unwrap_or(&exact);
    let command_portable = command.strip_prefix(r"\\?\").unwrap_or(&command);
    (same_path(Path::new(&command), executable) || command_portable.eq_ignore_ascii_case(portable))
        && args == ["mcp", "stdio"]
}

fn text_has_openkeylet_command(text: &str) -> bool {
    cli_command(text).is_some_and(|(command, _)| is_openkeylet_command(&command))
}

fn is_openkeylet_command(command: &str) -> bool {
    let file_name = command
        .trim()
        .trim_matches(['\'', '"'])
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(command);
    Path::new(file_name)
        .file_stem()
        .and_then(|name| name.to_str())
        .is_some_and(|name| {
            SERVER_NAMES
                .iter()
                .any(|alias| name.eq_ignore_ascii_case(alias))
        })
}

fn same_path(left: &Path, right: &Path) -> bool {
    let left = normalize_path(left);
    let right = normalize_path(right);
    if cfg!(windows) {
        left.to_string_lossy()
            .eq_ignore_ascii_case(&right.to_string_lossy())
    } else {
        left == right
    }
}

fn normalize_path(path: impl AsRef<Path>) -> PathBuf {
    fs::canonicalize(path.as_ref()).unwrap_or_else(|_| path.as_ref().to_path_buf())
}

fn node_script_argument_path(path: &Path) -> String {
    #[cfg(windows)]
    {
        let path = path.to_string_lossy();
        if let Some(path) = path.strip_prefix(r"\\?\UNC\") {
            format!(r"\\{path}")
        } else {
            path.strip_prefix(r"\\?\").unwrap_or(&path).to_owned()
        }
    }
    #[cfg(not(windows))]
    {
        path.to_string_lossy().into_owned()
    }
}

fn is_runnable_file(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::metadata(path).is_ok_and(|metadata| metadata.permissions().mode() & 0o111 != 0)
    }
    #[cfg(not(unix))]
    true
}

fn env_path(name: &str) -> Option<PathBuf> {
    env::var_os(name)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

fn resolve_codex_home(home: &Path, configured: Option<PathBuf>) -> PathBuf {
    configured
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or_else(|| home.join(".codex"))
}

fn resolve_opencode_config(
    home: &Path,
    configured_file: Option<PathBuf>,
    configured_directory: Option<PathBuf>,
    xdg_config_home: Option<PathBuf>,
) -> (PathBuf, bool) {
    if let Some(path) = configured_file.filter(|path| !path.as_os_str().is_empty()) {
        return (path, true);
    }
    if let Some(directory) = configured_directory.filter(|path| !path.as_os_str().is_empty()) {
        return (preferred_json_config(&directory), true);
    }
    let base = xdg_config_home
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or_else(|| home.join(".config"));
    (preferred_json_config(&base.join("opencode")), false)
}

fn preferred_json_config(directory: &Path) -> PathBuf {
    let jsonc = directory.join("opencode.jsonc");
    if jsonc.is_file() {
        return jsonc;
    }
    let json = directory.join("opencode.json");
    if json.is_file() { json } else { jsonc }
}

fn resolve_openclaw_config(home: &Path, configured: Option<PathBuf>) -> PathBuf {
    configured
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or_else(|| home.join(".openclaw").join("openclaw.json"))
}

fn toml_array_strings(array: &Array) -> Vec<String> {
    array
        .iter()
        .filter_map(|value| value.as_str().map(str::to_owned))
        .collect()
}

fn json_array_strings(value: Option<&JsonValue>) -> Vec<String> {
    value
        .and_then(JsonValue::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(JsonValue::as_str)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

fn read_or(path: &Path, fallback: &str) -> Result<String> {
    match fs::read_to_string(path) {
        Ok(value) => Ok(value),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(fallback.to_owned()),
        Err(error) => Err(error).with_context(|| format!("Unable to read {}", path.display())),
    }
}

fn has_legacy_instruction(text: &str) -> bool {
    [
        OPENKEYLET_INSTRUCTION_START,
        OPENKEYLET_INSTRUCTION_END,
        LEGACY_INSTRUCTION_START,
        LEGACY_INSTRUCTION_END,
    ]
    .iter()
    .any(|marker| text.contains(marker))
}

fn has_managed_instruction(text: &str) -> bool {
    text.contains(KEYHUB_INSTRUCTION_START) || has_legacy_instruction(text)
}

fn upsert_managed_instruction(path: &Path, dedicated_file: bool) -> Result<()> {
    let original = read_or(path, "")?;
    if dedicated_file && !original.trim().is_empty() && !has_managed_instruction(&original) {
        bail!(
            "{} Already exists and is not a KeyHub managed rule; not overwritten",
            path.display()
        );
    }
    let mut updated = strip_managed_instruction(&original)?
        .trim_end_matches(['\r', '\n'])
        .to_owned();
    if !updated.is_empty() {
        updated.push_str("\n\n");
    }
    updated.push_str(KEYHUB_INSTRUCTION_BLOCK);
    updated.push('\n');
    write_atomic_checked(path, &original, &updated)
}

fn remove_managed_instruction(path: &Path, dedicated_file: bool) -> Result<()> {
    if !path.is_file() {
        return Ok(());
    }
    let original = fs::read_to_string(path)
        .with_context(|| format!("Unable to read Agent global rules {}", path.display()))?;
    if !has_managed_instruction(&original) && !has_legacy_instruction(&original) {
        return Ok(());
    }
    let updated = strip_managed_instruction(&original)?;
    if dedicated_file && updated.trim().is_empty() {
        fs::remove_file(path)
            .with_context(|| format!("Unable to remove KeyHub global rule {}", path.display()))?;
        return Ok(());
    }
    write_atomic_checked(path, &original, &updated)
}

fn strip_managed_instruction(text: &str) -> Result<String> {
    let text = strip_instruction_block(text, LEGACY_INSTRUCTION_START, LEGACY_INSTRUCTION_END)?;
    let text = strip_instruction_block(
        &text,
        OPENKEYLET_INSTRUCTION_START,
        OPENKEYLET_INSTRUCTION_END,
    )?;
    strip_instruction_block(&text, KEYHUB_INSTRUCTION_START, KEYHUB_INSTRUCTION_END)
}

fn strip_instruction_block(text: &str, start_marker: &str, end_marker: &str) -> Result<String> {
    let Some(start) = text.find(start_marker) else {
        if text.contains(end_marker) {
            bail!("KeyHub managed marker in Agent global rules is incomplete");
        }
        return Ok(text.to_owned());
    };
    let content_start = start + start_marker.len();
    let end_offset = text[content_start..]
        .find(end_marker)
        .context("KeyHub managed marker in Agent global rules is incomplete")?;
    let end = content_start + end_offset + end_marker.len();
    let mut before = text[..start].trim_end_matches(['\r', '\n']).to_owned();
    let after = text[end..].trim_start_matches(['\r', '\n']);
    if !before.is_empty() && !after.is_empty() {
        before.push_str("\n\n");
    }
    before.push_str(after);
    if !before.is_empty() && text.ends_with('\n') && !before.ends_with('\n') {
        before.push('\n');
    }
    Ok(before)
}

fn write_atomic_checked(path: &Path, expected: &str, value: &str) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).context("Unable to create Agent configuration directory")?;
    }
    let current = read_or(path, expected)?;
    if current != expected {
        bail!("Agent configuration changed during modification; rescan and try again");
    }
    let mut writer = AtomicWriteFile::open(path)
        .context("Unable to create temporary Agent configuration file")?;
    writer
        .write_all(value.as_bytes())
        .context("Unable to write Agent configuration")?;
    writer
        .commit()
        .context("Unable to save Agent configuration atomically")?;
    Ok(())
}

fn backup_config(path: &Path) -> Result<PathBuf> {
    let stamp = Utc::now().format("%Y%m%dT%H%M%SZ");
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("config");
    let backup = path.with_file_name(format!("{file_name}.keyhub.{stamp}.bak"));
    fs::copy(path, &backup).context("Unable to back up conflicting configuration")?;
    Ok(backup)
}

fn output_text(output: &Output) -> String {
    format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    )
}

fn is_missing_entry(text: &str) -> bool {
    let text = text.to_ascii_lowercase();
    [
        "not found",
        "does not exist",
        "no mcp",
        "unknown mcp",
        "unknown server",
        "Not found",
        "Does not exist",
    ]
    .iter()
    .any(|needle| text.contains(needle))
}

fn clean_process_error(text: &str) -> String {
    let text = text.trim();
    if text.is_empty() {
        "Agent CLI operation failed".to_owned()
    } else {
        text.chars().take(600).collect()
    }
}

fn display_name(client_id: &str) -> &str {
    match client_id {
        "codex" => "Codex",
        "claude-code" => "Claude Code",
        "cursor" => "Cursor",
        "opencode" => "OpenCode",
        "openclaw" => "OpenClaw",
        _ => "Unknown Agent",
    }
}

fn action_label(action: &str) -> &str {
    match action {
        "register" => "Connect",
        "repair" => "Repair",
        "remove" => "Remove",
        _ => "Actions",
    }
}

#[cfg(target_os = "macos")]
fn app_translocated(path: &Path) -> bool {
    path.components().any(|component| {
        component
            .as_os_str()
            .to_string_lossy()
            .eq_ignore_ascii_case("AppTranslocation")
    })
}

#[cfg(not(target_os = "macos"))]
fn app_translocated(_path: &Path) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn registry() -> (tempfile::TempDir, AgentRegistry) {
        let temp = tempdir().unwrap();
        let exe = temp.path().join(if cfg!(windows) {
            "keyhub.exe"
        } else {
            "keyhub"
        });
        fs::write(&exe, b"test").unwrap();
        let registry = AgentRegistry::isolated(exe, temp.path().to_path_buf(), vec![]);
        (temp, registry)
    }

    #[test]
    fn keyhub_command_and_instruction_brand_are_canonical() {
        for command in [
            "keyhub",
            "/opt/keyhub",
            r"C:\tools\keyhub.exe",
            "openkeylet",
            "kru",
        ] {
            assert!(is_openkeylet_command(command), "{command}");
        }
        let temp = tempdir().unwrap();
        let path = temp.path().join("AGENTS.md");
        fs::write(
            &path,
            format!(
                "# Personal\n\n{OPENKEYLET_INSTRUCTION_START}\nold\n{OPENKEYLET_INSTRUCTION_END}\n"
            ),
        )
        .unwrap();
        upsert_managed_instruction(&path, false).unwrap();
        let text = fs::read_to_string(path).unwrap();
        assert!(text.contains("<!-- KEYHUB MANAGED INSTRUCTION START -->"));
        assert!(text.contains("prefer KeyHub"));
        assert!(!text.contains(OPENKEYLET_INSTRUCTION_START));
    }

    #[test]
    fn keyhub_cli_ownership_cannot_come_from_name_description_or_path_prefix() {
        let executable = Path::new("/opt/keyhub");
        assert!(!text_matches(
            r#"{"name":"keyhub","description":"/opt/keyhub mcp stdio","command":"/opt/other","args":["mcp","stdio"]}"#,
            executable
        ));
        assert!(!text_matches(
            "Command: /opt/keyhub-unrelated\nArgs: mcp stdio",
            executable
        ));
        assert!(!text_matches(
            r#"{"command":"/opt/keyhub","args":["mcp","not-stdio"],"description":"stdio"}"#,
            executable
        ));
        assert!(text_matches(
            r#"{"command":["/opt/keyhub","mcp","stdio"]}"#,
            executable
        ));
    }

    #[tokio::test]
    async fn keyhub_codex_migration_is_explicit_and_keeps_disabled_state() {
        let (_temp, registry) = registry();
        let path = registry.config_path("codex");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let original = "# personal\n[mcp_servers.openkeylet]\n# disabled by user\ncommand = '/old/openkeylet'\nargs = ['mcp', 'stdio']\nenabled = false\n[mcp_servers.kru]\ncommand = 'unrelated-tool'\n";
        fs::write(&path, original).unwrap();
        assert_eq!(registry.status("codex").await.state, "stale");
        registry.refresh_managed_instructions();
        assert_eq!(fs::read_to_string(&path).unwrap(), original);
        assert!(registry.mutate("codex", "repair").await.ok);
        let text = fs::read_to_string(&path).unwrap();
        let document = text.parse::<DocumentMut>().unwrap();
        assert_eq!(
            document["mcp_servers"]["keyhub"]["enabled"].as_bool(),
            Some(false)
        );
        assert!(document["mcp_servers"].get("openkeylet").is_none());
        assert_eq!(
            document["mcp_servers"]["kru"]["command"].as_str(),
            Some("unrelated-tool")
        );
        assert!(text.contains("# disabled by user"));
    }

    #[test]
    fn keyhub_json_migration_preserves_disabled_comments_and_unrelated_aliases() {
        for (client, container) in [
            ("cursor", "mcpServers"),
            ("opencode", "mcp"),
            ("opencode", "mcp/servers"),
        ] {
            let (_temp, registry) = registry();
            let path = registry.config_path(client);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            let managed = if client == "cursor" {
                r#"{"command":"/old/openkeylet","args":["mcp","stdio"],"disabled":true,"env":{"KEEP":"yes"}}"#
            } else {
                r#"{"type":"local","command":["/old/openkeylet","mcp","stdio"],"enabled":false,"env":{"KEEP":"yes"}}"#
            };
            let mut input = serde_json::json!({});
            let mut servers = serde_json::Map::new();
            servers.insert("openkeylet".into(), serde_json::from_str(managed).unwrap());
            servers.insert(
                "kru".into(),
                serde_json::json!({"command":"unrelated-tool"}),
            );
            if container == "mcp/servers" {
                input["mcp"] = serde_json::json!({"servers": servers});
            } else {
                input[container] = JsonValue::Object(servers);
            }
            let original = format!("// personal comment\n{input}\n");
            fs::write(&path, &original).unwrap();
            assert_eq!(
                registry.inspect_json_client(client).unwrap(),
                EntryState::Stale
            );
            assert_eq!(fs::read_to_string(&path).unwrap(), original);
            registry.mutate_json_client(client, "repair").unwrap();
            let text = fs::read_to_string(&path).unwrap();
            let value: JsonValue = parse_to_serde_value(&text, &ParseOptions::default()).unwrap();
            assert!(text.contains("// personal comment"));
            let servers = value.pointer(&format!("/{container}")).unwrap();
            assert!(servers.get("openkeylet").is_none());
            assert_eq!(servers["kru"]["command"], "unrelated-tool");
            assert_eq!(servers["keyhub"]["env"]["KEEP"], "yes");
            assert_eq!(
                servers["keyhub"][if client == "cursor" {
                    "disabled"
                } else {
                    "enabled"
                }],
                client == "cursor"
            );
            registry.mutate_json_client(client, "remove").unwrap();
            assert!(fs::read_to_string(path).unwrap().contains("unrelated-tool"));
        }
    }

    #[test]
    fn keyhub_claude_legacy_rule_names_are_reused_only_when_managed() {
        let (_temp, registry) = registry();
        let rules = registry.home.join(".claude/rules");
        fs::create_dir_all(&rules).unwrap();
        fs::write(rules.join("openkeylet.md"), "personal rule\n").unwrap();
        fs::write(rules.join("kru.md"), "another personal rule\n").unwrap();
        assert_eq!(
            registry.active_instruction_path("claude-code").unwrap(),
            rules.join("keyhub.md")
        );
        registry
            .mutate_global_instruction("claude-code", "register")
            .unwrap();
        assert!(
            fs::read_to_string(rules.join("keyhub.md"))
                .unwrap()
                .contains("<!-- KEYHUB MANAGED INSTRUCTION START -->")
        );
        registry
            .mutate_global_instruction("claude-code", "remove")
            .unwrap();
        assert_eq!(
            fs::read_to_string(rules.join("openkeylet.md")).unwrap(),
            "personal rule\n"
        );
        assert_eq!(
            fs::read_to_string(rules.join("kru.md")).unwrap(),
            "another personal rule\n"
        );
    }

    #[test]
    fn keyhub_legacy_instruction_refresh_waits_for_explicit_repair() {
        for (start, end) in [
            (OPENKEYLET_INSTRUCTION_START, OPENKEYLET_INSTRUCTION_END),
            (LEGACY_INSTRUCTION_START, LEGACY_INSTRUCTION_END),
        ] {
            let (_temp, registry) = registry();
            let path = registry.codex_home.join("AGENTS.md");
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            let original = format!("# Personal\n\n{start}\nold instructions\n{end}\n");
            fs::write(&path, &original).unwrap();
            registry.refresh_managed_instructions();
            assert_eq!(fs::read_to_string(&path).unwrap(), original);
            registry
                .mutate_global_instruction("codex", "repair")
                .unwrap();
            let updated = fs::read_to_string(&path).unwrap();
            assert!(updated.starts_with("# Personal\n"));
            assert!(updated.contains(KEYHUB_INSTRUCTION_BLOCK));
            assert!(!updated.contains(start));
        }
    }

    #[test]
    fn keyhub_json_comments_inside_migrated_entry_survive() {
        let (_temp, registry) = registry();
        let path = registry.config_path("cursor");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, "{\"mcpServers\": {\n// managed server note\n\"openkeylet\": {\n// command note\n\"command\": \"/old/openkeylet\",\n// credentials note\n\"env\": {\"KEEP\": \"yes\"},\n\"disabled\": true\n}}}\n").unwrap();
        registry.mutate_json_client("cursor", "repair").unwrap();
        let text = fs::read_to_string(path).unwrap();
        for comment in ["managed server note", "command note", "credentials note"] {
            assert!(text.contains(comment));
        }
    }

    #[cfg(unix)]
    fn fake_cli_registry(
        client: &str,
        unrelated_legacy: bool,
    ) -> (tempfile::TempDir, AgentRegistry, PathBuf) {
        let (temp, registry) = registry();
        let cli = registry
            .home
            .join(".local/bin")
            .join(if client == "claude-code" {
                "claude"
            } else {
                "openclaw"
            });
        fs::create_dir_all(cli.parent().unwrap()).unwrap();
        let log = registry.home.join("calls");
        let legacy = if unrelated_legacy {
            "/opt/other-tool"
        } else {
            "/old/kru"
        };
        let script = format!(
            r#"#!/bin/sh
cd "$(dirname "$0")/../.." || exit 1
printf '%s\n' "$*" >> calls
case "$2" in
  get|show)
    case "$3" in
      keyhub) test -f added || {{ echo 'not found' >&2; exit 1; }}; printf '{{"command":"%s","args":["mcp","stdio"]}}\n' '{exe}';;
      openkeylet) test ! -f removed-openkeylet || {{ echo 'not found' >&2; exit 1; }}; echo '{{"command":["/old/openkeylet","mcp","stdio"]}}';;
      kru) test ! -f removed-kru || {{ echo 'not found' >&2; exit 1; }}; echo '{{"command":"{legacy}","args":["mcp","stdio"]}}';;
    esac;;
  add) touch added;;
  remove|unset) for name in "$@"; do case "$name" in keyhub|openkeylet|kru) touch "removed-$name";; esac; done;;
  *) exit 2;;
esac
"#,
            exe = registry.executable.display()
        );
        fs::write(&cli, script).unwrap();
        make_test_executable(&cli);
        (temp, registry, log)
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn keyhub_cli_clients_migrate_owned_aliases_only_on_explicit_repair() {
        for client in ["claude-code", "openclaw"] {
            for unrelated in [true, false] {
                let (_temp, registry, log) = fake_cli_registry(client, unrelated);
                assert_eq!(registry.status(client).await.state, "stale");
                let calls = fs::read_to_string(&log).unwrap();
                assert!(!calls.contains("mcp add"));
                assert!(!calls.contains("mcp remove"));
                assert!(!calls.contains("mcp unset"));
                let result = registry.mutate(client, "repair").await;
                assert!(result.ok, "{}", result.client.message);
                let calls = fs::read_to_string(&log).unwrap();
                assert!(calls.lines().any(|line| line.starts_with("mcp add")
                    && line.split_whitespace().any(|part| part == "keyhub")));
                assert!(registry.home.join("removed-openkeylet").is_file());
                assert_eq!(registry.home.join("removed-kru").is_file(), !unrelated);
                assert_eq!(registry.status(client).await.state, "registered");
            }
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn keyhub_cli_repairs_preserve_config_disabled_state_and_comments() {
        for client in ["claude-code", "openclaw"] {
            let (_temp, registry, log) = fake_cli_registry(client, false);
            let path = registry.config_path(client);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            let input = if client == "claude-code" {
                "// personal config\n{\"mcpServers\":{\"openkeylet\":{\n// owned entry note\n\"command\":\"/old/openkeylet\",\"args\":[\"mcp\",\"stdio\"],\"disabled\":true,\"env\":{\"KEEP\":\"yes\"}},\"kru\":{\"command\":\"unrelated-tool\"}},\"disabledMcpServers\":[\"openkeylet\",\"other\"]}\n"
            } else {
                "// personal config\n{\"mcp\":{\"servers\":{\"openkeylet\":{\n// owned entry note\n\"command\":[\"/old/openkeylet\",\"mcp\",\"stdio\"],\"enabled\":false,\"env\":{\"KEEP\":\"yes\"}},\"kru\":{\"command\":\"unrelated-tool\"}}}}\n"
            };
            fs::write(&path, input).unwrap();
            registry.mutate_cli_client(client, "repair").await.unwrap();
            let text = fs::read_to_string(&path).unwrap();
            let value: JsonValue = parse_to_serde_value(&text, &ParseOptions::default()).unwrap();
            let container = if client == "claude-code" {
                &value["mcpServers"]
            } else {
                &value["mcp"]["servers"]
            };
            assert!(container.get("openkeylet").is_none());
            assert_eq!(container["keyhub"]["env"]["KEEP"], "yes");
            assert_eq!(container["kru"]["command"], "unrelated-tool");
            assert_eq!(
                container["keyhub"][if client == "claude-code" {
                    "disabled"
                } else {
                    "enabled"
                }],
                client == "claude-code"
            );
            if client == "claude-code" {
                assert_eq!(
                    value["disabledMcpServers"],
                    serde_json::json!(["keyhub", "other"])
                );
            }
            assert!(text.contains("// personal config"));
            assert!(text.contains("// owned entry note"));
            assert!(
                !fs::read_to_string(log)
                    .unwrap_or_default()
                    .contains("mcp add")
            );
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn keyhub_openclaw_preserves_string_command_shape() {
        let (_temp, registry, _log) = fake_cli_registry("openclaw", false);
        let path = registry.config_path("openclaw");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, "{\"mcp\":{\"servers\":{\"openkeylet\":{\"command\":\"/old/openkeylet\",\"args\":[\"mcp\",\"stdio\"],\"enabled\":false}}}}\n").unwrap();
        registry
            .mutate_cli_client("openclaw", "repair")
            .await
            .unwrap();
        let text = fs::read_to_string(path).unwrap();
        let value: JsonValue = serde_json::from_str(&text).unwrap();
        assert_eq!(
            value["mcp"]["servers"]["keyhub"]["command"],
            registry.executable.to_string_lossy().as_ref()
        );
        assert_eq!(
            value["mcp"]["servers"]["keyhub"]["args"],
            serde_json::json!(["mcp", "stdio"])
        );
        assert_eq!(value["mcp"]["servers"]["keyhub"]["enabled"], false);
        assert!(value["mcp"]["servers"]["keyhub"].get("type").is_none());
    }

    #[tokio::test]
    async fn regression_opencode_dual_canonical_conflict_never_reports_success() {
        for owned_v2 in [true, false] {
            let (_temp, registry) = registry();
            let path = registry.config_path("opencode");
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            let owned = serde_json::json!({"command": [registry.executable, "mcp", "stdio"], "enabled": false});
            let unrelated =
                serde_json::json!({"command": ["unrelated-tool"], "env": {"KEEP": "yes"}});
            let (v2, v1) = if owned_v2 {
                (&owned, &unrelated)
            } else {
                (&unrelated, &owned)
            };
            let original = format!(
                "// preserve canonical conflict\n{}\n",
                serde_json::json!({"mcp": {"servers": {"keyhub": v2}, "keyhub": v1, "openkeylet": {"command": ["personal-tool"]}, "kru": {"command": ["another-personal-tool"]}}})
            );
            fs::write(&path, &original).unwrap();
            assert_eq!(registry.status("opencode").await.state, "conflict");
            let result = registry.repair("opencode").await;
            assert!(
                !result.ok,
                "repair must not report success with unresolved canonical conflict"
            );
            assert_eq!(result.client.state, "conflict");
            assert!(
                result.client.message.contains("unrelated"),
                "{}",
                result.client.message
            );
            assert_eq!(registry.status("opencode").await.state, "conflict");
            assert_eq!(fs::read_to_string(&path).unwrap(), original);
            assert!(!registry.opencode_instruction_dir.join("AGENTS.md").exists());
        }
    }

    #[tokio::test]
    async fn keyhub_json_conflicts_require_repair_and_backup_original() {
        for client in ["cursor", "opencode"] {
            let (_temp, registry) = registry();
            let path = registry.config_path(client);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            let original = if client == "cursor" {
                "// keep\n{\"mcpServers\":{\"keyhub\":{\"command\":\"other\"},\"openkeylet\":{\"command\":\"unrelated\"}}}\n"
            } else {
                "// keep\n{\"mcp\":{\"keyhub\":{\"command\":[\"other\"]},\"openkeylet\":{\"command\":[\"unrelated\"]}}}\n"
            };
            fs::write(&path, original).unwrap();
            assert_eq!(registry.status(client).await.state, "conflict");
            assert!(!registry.mutate(client, "register").await.ok);
            assert_eq!(fs::read_to_string(&path).unwrap(), original);
            assert!(registry.mutate(client, "repair").await.ok);
            let backup = fs::read_dir(path.parent().unwrap())
                .unwrap()
                .filter_map(Result::ok)
                .map(|entry| entry.path())
                .find(|path| path.extension().is_some_and(|extension| extension == "bak"))
                .unwrap();
            assert_eq!(fs::read_to_string(backup).unwrap(), original);
            assert!(fs::read_to_string(path).unwrap().contains("unrelated"));
        }
    }

    #[test]
    fn keyhub_remove_preserves_unrelated_entries_even_with_canonical_name() {
        let (_temp, registry) = registry();
        let path = registry.config_path("codex");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let original = "# keep\n[mcp_servers.keyhub]\ncommand = 'unrelated'\n[mcp_servers.openkeylet]\ncommand = 'also-unrelated'\n";
        fs::write(&path, original).unwrap();
        registry.mutate_codex("remove").unwrap();
        assert_eq!(fs::read_to_string(path).unwrap(), original);
        for client in ["cursor", "opencode"] {
            let path = registry.config_path(client);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            let original = if client == "cursor" {
                "// keep\n{\"mcpServers\":{\"keyhub\":{\"command\":\"other\"},\"openkeylet\":{\"command\":\"unrelated\"}}}\n"
            } else {
                "// keep\n{\"mcp\":{\"keyhub\":{\"command\":[\"other\"]},\"servers\":{\"openkeylet\":{\"command\":[\"unrelated\"]}}}}\n"
            };
            fs::write(&path, original).unwrap();
            registry.mutate_json_client(client, "remove").unwrap();
            assert_eq!(fs::read_to_string(path).unwrap(), original);
        }
    }

    #[test]
    fn legacy_codex_config_is_repaired_without_touching_other_servers() {
        let (_temp, registry) = registry();
        let path = registry.config_path("codex");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, "# personal config\n[mcp_servers.other]\ncommand = \"other-tool\"\n[mcp_servers.kru]\ncommand = \"/old/kru\"\nargs = [\"mcp\", \"stdio\"]\n").unwrap();
        assert_eq!(registry.inspect_codex().unwrap(), EntryState::Stale);
        registry.mutate_codex("repair").unwrap();
        assert_eq!(registry.inspect_codex().unwrap(), EntryState::Registered);
        let text = fs::read_to_string(&path).unwrap();
        assert!(text.contains("# personal config"));
        assert!(text.contains("mcp_servers.other"));
        assert!(!text.contains("mcp_servers.kru"));
        assert!(fs::read_dir(path.parent().unwrap()).unwrap().any(|entry| {
            entry
                .unwrap()
                .path()
                .extension()
                .is_some_and(|extension| extension == "bak")
        }));
    }

    #[test]
    fn legacy_json_configs_migrate_both_opencode_shapes_and_cursor() {
        for (client, input, new_pointer, old_pointer) in [
            (
                "cursor",
                r#"{"mcpServers":{"kru":{"command":"/old/kru","args":["mcp","stdio"]},"other":{"command":"other-tool"}}}"#,
                "/mcpServers/keyhub",
                "/mcpServers/kru",
            ),
            (
                "opencode",
                r#"{"mcp":{"kru":{"type":"local","command":["/old/kru","mcp","stdio"]},"other":{"command":["other-tool"]}}}"#,
                "/mcp/keyhub",
                "/mcp/kru",
            ),
            (
                "opencode",
                r#"{"mcp":{"servers":{"kru":{"command":["/old/kru","mcp","stdio"]},"other":{"command":["other-tool"]}}}}"#,
                "/mcp/servers/keyhub",
                "/mcp/servers/kru",
            ),
        ] {
            let (_temp, registry) = registry();
            let path = registry.config_path(client);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, format!("// personal config\n{input}\n")).unwrap();
            assert_eq!(
                registry.inspect_json_client(client).unwrap(),
                EntryState::Stale
            );
            registry.mutate_json_client(client, "repair").unwrap();
            assert_eq!(
                registry.inspect_json_client(client).unwrap(),
                EntryState::Registered
            );
            let text = fs::read_to_string(&path).unwrap();
            let value: JsonValue = parse_to_serde_value(&text, &ParseOptions::default()).unwrap();
            assert!(value.pointer(new_pointer).is_some());
            assert!(value.pointer(old_pointer).is_none());
            assert!(text.contains("// personal config"));
            assert!(text.contains("other-tool"));
        }
    }

    #[test]
    fn unrelated_server_named_kru_is_preserved() {
        let (_temp, registry) = registry();
        let path = registry.config_path("codex");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, "[mcp_servers.kru]\ncommand = \"unrelated-tool\"\n").unwrap();
        assert_eq!(registry.inspect_codex().unwrap(), EntryState::Available);
        registry.mutate_codex("register").unwrap();
        assert!(
            fs::read_to_string(&path)
                .unwrap()
                .contains("unrelated-tool")
        );
        let path = registry.config_path("cursor");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(
            &path,
            r#"{"mcpServers":{"kru":{"command":"unrelated-tool"}}}"#,
        )
        .unwrap();
        registry.mutate_json_client("cursor", "register").unwrap();
        registry.mutate_json_client("cursor", "remove").unwrap();
        assert!(fs::read_to_string(path).unwrap().contains("unrelated-tool"));
    }

    #[test]
    fn legacy_managed_rules_are_replaced_once_and_preserve_personal_rules() {
        let (_temp, registry) = registry();
        let path = registry.home.join(".claude/rules/kru.md");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, format!("# Personal rules\n\n{LEGACY_INSTRUCTION_START}\nOld rule\n{LEGACY_INSTRUCTION_END}\n")).unwrap();
        assert_eq!(
            registry.active_instruction_path("claude-code").unwrap(),
            path
        );
        let before = fs::read_to_string(&path).unwrap();
        registry.refresh_managed_instructions();
        assert_eq!(fs::read_to_string(&path).unwrap(), before);
        registry
            .mutate_global_instruction("claude-code", "repair")
            .unwrap();
        registry
            .mutate_global_instruction("claude-code", "repair")
            .unwrap();
        let text = fs::read_to_string(&path).unwrap();
        assert!(text.starts_with("# Personal rules"));
        assert!(!text.contains(LEGACY_INSTRUCTION_START));
        assert_eq!(text.matches(KEYHUB_INSTRUCTION_START).count(), 1);
        remove_managed_instruction(&path, true).unwrap();
        assert_eq!(
            fs::read_to_string(&path).unwrap().trim(),
            "# Personal rules"
        );
    }

    fn make_test_executable(path: &Path) {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut permissions = fs::metadata(path).unwrap().permissions();
            permissions.set_mode(0o700);
            fs::set_permissions(path, permissions).unwrap();
        }
        #[cfg(not(unix))]
        let _ = path;
    }

    #[tokio::test]
    async fn codex_registration_preserves_unrelated_toml_and_is_idempotent() {
        let (_temp, registry) = registry();
        let path = registry.config_path("codex");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(
            &path,
            "# keep\nmodel = \"gpt-test\"\n\n[mcp_servers.other]\ncommand = \"other\"\n",
        )
        .unwrap();
        let first = registry.mutate("codex", "register").await;
        assert!(first.ok, "{}", first.client.message);
        let once = fs::read_to_string(&path).unwrap();
        assert!(once.contains("# keep"));
        assert!(once.contains("mcp_servers.other"));
        assert!(once.contains("mcp_servers.keyhub"));
        let instruction = fs::read_to_string(registry.codex_home.join("AGENTS.md")).unwrap();
        assert!(instruction.contains(KEYHUB_INSTRUCTION_BLOCK));
        let second = registry.mutate("codex", "register").await;
        assert!(!second.ok);
        assert_eq!(once, fs::read_to_string(&path).unwrap());
    }

    #[tokio::test]
    async fn codex_instruction_uses_override_and_removal_preserves_user_content() {
        let (_temp, registry) = registry();
        let config = registry.config_path("codex");
        fs::create_dir_all(config.parent().unwrap()).unwrap();
        fs::write(&config, "model = \"gpt-test\"\n").unwrap();
        let override_path = registry.codex_home.join("AGENTS.override.md");
        fs::write(&override_path, "# Personal rules\n").unwrap();

        assert!(registry.mutate("codex", "register").await.ok);
        let installed = fs::read_to_string(&override_path).unwrap();
        assert!(installed.starts_with("# Personal rules\n"));
        assert!(installed.contains(KEYHUB_INSTRUCTION_BLOCK));
        assert!(!registry.codex_home.join("AGENTS.md").exists());

        assert!(registry.mutate("codex", "remove").await.ok);
        assert_eq!(
            fs::read_to_string(&override_path).unwrap(),
            "# Personal rules\n"
        );
    }

    #[tokio::test]
    async fn existing_codex_connection_without_global_rule_requires_repair() {
        let (_temp, registry) = registry();
        registry.mutate_codex("register").unwrap();

        let before = registry.status("codex").await;
        assert_eq!(before.state, "stale");
        assert!(before.can_repair);

        assert!(registry.mutate("codex", "repair").await.ok);
        assert_eq!(registry.status("codex").await.state, "registered");
        assert!(registry.codex_home.join("AGENTS.md").is_file());
    }

    #[tokio::test]
    async fn existing_managed_instruction_is_refreshed_without_touching_user_content() {
        let (_temp, registry) = registry();
        let config = registry.config_path("codex");
        fs::create_dir_all(config.parent().unwrap()).unwrap();
        fs::write(&config, "model = \"gpt-test\"\n").unwrap();
        assert!(registry.mutate("codex", "register").await.ok);
        let path = registry.codex_home.join("AGENTS.md");
        fs::write(
            &path,
            format!(
                "# Personal rules\n\n{KEYHUB_INSTRUCTION_START}\nOld KeyHub instruction.\n{KEYHUB_INSTRUCTION_END}\n"
            ),
        )
        .unwrap();

        registry.refresh_managed_instructions();
        let updated = fs::read_to_string(path).unwrap();
        assert!(updated.starts_with("# Personal rules\n"));
        assert!(updated.contains(KEYHUB_INSTRUCTION_BLOCK));
        assert!(!updated.contains("Old KeyHub instruction."));
    }

    #[test]
    fn dedicated_rule_never_overwrites_an_unmanaged_file() {
        let temp = tempdir().unwrap();
        let path = temp.path().join("openkeylet.md");
        fs::write(&path, "user-owned rule\n").unwrap();

        let error = upsert_managed_instruction(&path, true).unwrap_err();
        assert!(error.to_string().contains("not a KeyHub managed rule"));
        assert_eq!(fs::read_to_string(path).unwrap(), "user-owned rule\n");
    }

    #[tokio::test]
    async fn cursor_registration_and_removal_preserve_jsonc_comments() {
        let (_temp, registry) = registry();
        let path = registry.config_path("cursor");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, "{\n  // keep\n  \"theme\": \"dark\",\n  \"mcpServers\": { \"other\": { \"command\": \"other\" } }\n}\n").unwrap();
        assert!(registry.mutate("cursor", "register").await.ok);
        let registered = fs::read_to_string(&path).unwrap();
        assert!(registered.contains("// keep"));
        assert!(registered.contains("\"other\""));
        assert!(registered.contains("\"keyhub\""));
        assert!(registry.mutate("cursor", "remove").await.ok);
        let removed = fs::read_to_string(&path).unwrap();
        assert!(removed.contains("// keep"));
        assert!(removed.contains("\"other\""));
        assert!(!removed.contains("\"keyhub\""));
    }

    #[tokio::test]
    async fn conflicting_entry_is_not_overwritten_without_repair() {
        let (_temp, registry) = registry();
        let path = registry.config_path("codex");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let original = "[mcp_servers.keyhub]\ncommand = \"not-openkeylet\"\nargs = []\n";
        fs::write(&path, original).unwrap();
        let status = registry.status("codex").await;
        assert_eq!(status.state, "conflict");
        assert!(!registry.mutate("codex", "register").await.ok);
        assert_eq!(fs::read_to_string(&path).unwrap(), original);
        assert!(registry.mutate("codex", "repair").await.ok);
        assert!(fs::read_dir(path.parent().unwrap()).unwrap().any(|item| {
            item.unwrap()
                .file_name()
                .to_string_lossy()
                .contains(".keyhub.")
        }));
    }

    #[tokio::test]
    async fn opencode_registration_defaults_to_v1_and_preserves_jsonc() {
        let (_temp, registry) = registry();
        let path = registry.config_path("opencode");
        assert_eq!(path.file_name().unwrap(), "opencode.jsonc");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(
            &path,
            "{\n  // keep this comment\n  \"theme\": \"dark\",\n  \"mcp\": {}\n}\n",
        )
        .unwrap();
        assert!(registry.mutate("opencode", "register").await.ok);
        let text = fs::read_to_string(&path).unwrap();
        assert!(text.contains("// keep this comment"));
        assert!(text.contains("\"theme\": \"dark\""));
        let value: JsonValue = parse_to_serde_value(&text, &ParseOptions::default()).unwrap();
        assert_eq!(
            value.pointer("/mcp/keyhub/type"),
            Some(&serde_json::json!("local"))
        );
        let command = value
            .pointer("/mcp/keyhub/command")
            .and_then(JsonValue::as_array)
            .unwrap();
        assert_eq!(command[1], "mcp");
        assert_eq!(command[2], "stdio");
        assert_eq!(
            value.pointer("/mcp/keyhub/enabled"),
            Some(&serde_json::json!(true))
        );
        assert!(value.pointer("/mcp/servers").is_none());
        assert!(
            fs::read_to_string(registry.opencode_instruction_dir.join("AGENTS.md"))
                .unwrap()
                .contains(KEYHUB_INSTRUCTION_BLOCK)
        );
        assert_eq!(registry.status("opencode").await.state, "registered");
    }

    #[tokio::test]
    async fn opencode_registration_uses_v2_when_servers_container_exists() {
        let (_temp, registry) = registry();
        let path = registry.config_path("opencode");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(
            &path,
            "{\n  // V2 config\n  \"mcp\": { \"servers\": {} }\n}\n",
        )
        .unwrap();
        assert!(registry.mutate("opencode", "register").await.ok);
        let text = fs::read_to_string(&path).unwrap();
        assert!(text.contains("// V2 config"));
        let value: JsonValue = parse_to_serde_value(&text, &ParseOptions::default()).unwrap();
        assert!(value.pointer("/mcp/keyhub").is_none());
        assert!(value.pointer("/mcp/servers/keyhub").is_some());
        assert!(value.pointer("/mcp/servers/keyhub/enabled").is_none());
        assert_eq!(registry.status("opencode").await.state, "registered");
    }

    #[tokio::test]
    async fn opencode_repair_keeps_v1_shape_and_disabled_state() {
        let (_temp, registry) = registry();
        let path = registry.config_path("opencode");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let executable = serde_json::to_string(&registry.executable.to_string_lossy()).unwrap();
        fs::write(
            &path,
            format!(
                "{{\n  // V1 setting stays readable\n  \"mcp\": {{\n    \"keyhub\": {{ \"type\": \"local\", \"command\": [{executable}, \"mcp\", \"stdio\"], \"enabled\": false }}\n  }}\n}}\n"
            ),
        )
        .unwrap();

        let status = registry.status("opencode").await;
        assert_eq!(status.state, "stale");
        assert!(status.can_repair);
        assert!(registry.mutate("opencode", "repair").await.ok);

        let text = fs::read_to_string(&path).unwrap();
        assert!(text.contains("// V1 setting stays readable"));
        let value: JsonValue = parse_to_serde_value(&text, &ParseOptions::default()).unwrap();
        assert_eq!(
            value.pointer("/mcp/keyhub/enabled"),
            Some(&serde_json::json!(false))
        );
        assert!(value.pointer("/mcp/servers").is_none());
        assert!(fs::read_dir(path.parent().unwrap()).unwrap().any(|item| {
            item.unwrap()
                .file_name()
                .to_string_lossy()
                .contains("opencode.jsonc.keyhub.")
        }));
    }

    #[tokio::test]
    async fn opencode_remove_cleans_current_and_legacy_entries() {
        let (_temp, registry) = registry();
        let path = registry.config_path("opencode");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let executable = serde_json::to_string(&registry.executable.to_string_lossy()).unwrap();
        fs::write(
            &path,
            format!(
                "{{ \"mcp\": {{ \"keyhub\": {{ \"command\": [{executable}, \"mcp\", \"stdio\"] }}, \"servers\": {{ \"keyhub\": {{ \"command\": [{executable}, \"mcp\", \"stdio\"] }} }} }} }}\n"
            ),
        )
        .unwrap();

        assert_eq!(registry.status("opencode").await.state, "stale");
        assert!(registry.mutate("opencode", "remove").await.ok);
        let text = fs::read_to_string(&path).unwrap();
        let value: JsonValue = parse_to_serde_value(&text, &ParseOptions::default()).unwrap();
        assert!(value.pointer("/mcp/keyhub").is_none());
        assert!(value.pointer("/mcp/servers/keyhub").is_none());
    }

    #[tokio::test]
    async fn opencode_uses_existing_json_file_when_jsonc_is_absent() {
        let (_temp, registry) = registry();
        let directory = registry.home.join(".config").join("opencode");
        fs::create_dir_all(&directory).unwrap();
        let json = directory.join("opencode.json");
        fs::write(&json, "{}\n").unwrap();

        assert_eq!(registry.config_path("opencode"), json);
        assert!(registry.mutate("opencode", "register").await.ok);
        let value: JsonValue = serde_json::from_str(&fs::read_to_string(json).unwrap()).unwrap();
        assert!(value.pointer("/mcp/keyhub").is_some());
    }

    #[test]
    fn codex_config_path_uses_configured_codex_home() {
        let (temp, mut registry) = registry();
        let codex_home = temp.path().join("portable-codex-home");
        assert_eq!(
            resolve_codex_home(temp.path(), Some(codex_home.clone())),
            codex_home
        );
        registry.codex_home = codex_home.clone();
        assert_eq!(
            registry.config_path("codex"),
            codex_home.join("config.toml")
        );
    }

    #[test]
    fn config_overrides_and_xdg_paths_are_respected() {
        let temp = tempdir().unwrap();
        let home = temp.path().join("home");
        let exact = temp.path().join("custom").join("open.jsonc");
        let directory = temp.path().join("opencode-dir");
        let xdg = temp.path().join("xdg");

        let resolved = resolve_opencode_config(
            &home,
            Some(exact.clone()),
            Some(directory.clone()),
            Some(xdg.clone()),
        );
        assert_eq!(resolved, (exact, true));

        let resolved =
            resolve_opencode_config(&home, None, Some(directory.clone()), Some(xdg.clone()));
        assert_eq!(resolved, (directory.join("opencode.jsonc"), true));

        let resolved = resolve_opencode_config(&home, None, None, Some(xdg.clone()));
        assert_eq!(resolved, (xdg.join("opencode/opencode.jsonc"), false));

        let openclaw = temp.path().join("openclaw-custom.json5");
        assert_eq!(
            resolve_openclaw_config(&home, Some(openclaw.clone())),
            openclaw
        );
    }

    #[test]
    fn explicit_opencode_jsonc_path_is_not_replaced_by_a_sibling_json_file() {
        let (temp, mut registry) = registry();
        let directory = temp.path().join("explicit-opencode");
        fs::create_dir_all(&directory).unwrap();
        fs::write(directory.join("opencode.json"), "{}\n").unwrap();
        let explicit = directory.join("opencode.jsonc");
        registry.opencode_config = explicit.clone();
        registry.opencode_config_explicit = true;

        assert_eq!(registry.config_path("opencode"), explicit);
    }

    #[tokio::test]
    async fn opencode_explicit_or_existing_config_directory_allows_desktop_registration() {
        let (temp, mut registry) = registry();
        registry.opencode_config = temp.path().join("explicit").join("opencode.jsonc");
        registry.opencode_config_explicit = true;
        let explicit = registry.status("opencode").await;
        assert!(explicit.detected);
        assert!(explicit.can_register);
        assert_eq!(explicit.state, "available");

        registry.opencode_config_explicit = false;
        assert!(!registry.status("opencode").await.detected);
        fs::create_dir_all(registry.opencode_config.parent().unwrap()).unwrap();
        let desktop = registry.status("opencode").await;
        assert!(desktop.detected);
        assert!(desktop.can_register);
    }

    #[test]
    fn common_user_bin_directories_are_scanned_by_exact_name() {
        let (temp, registry) = registry();
        let suffix = if cfg!(windows) { ".exe" } else { "" };
        let opencode = temp
            .path()
            .join(".opencode/bin")
            .join(format!("opencode{suffix}"));
        fs::create_dir_all(opencode.parent().unwrap()).unwrap();
        fs::write(&opencode, b"test").unwrap();
        make_test_executable(&opencode);
        assert_eq!(
            registry.find_client_executable("opencode"),
            Some(normalize_path(&opencode))
        );

        let openclaw = temp
            .path()
            .join(".openclaw/bin")
            .join(format!("openclaw{suffix}"));
        fs::create_dir_all(openclaw.parent().unwrap()).unwrap();
        fs::write(&openclaw, b"test").unwrap();
        make_test_executable(&openclaw);
        assert_eq!(
            registry.find_client_executable("openclaw"),
            Some(normalize_path(&openclaw))
        );

        let unrelated = temp.path().join("bin/opencode-helper.exe");
        fs::create_dir_all(unrelated.parent().unwrap()).unwrap();
        fs::write(unrelated, b"test").unwrap();
        fs::remove_file(opencode).unwrap();
        assert!(registry.find_client_executable("opencode").is_none());
    }

    #[tokio::test]
    async fn list_preserves_stable_client_order() {
        let (_temp, registry) = registry();
        let ids = registry
            .list()
            .await
            .into_iter()
            .map(|status| status.client_id)
            .collect::<Vec<_>>();
        assert_eq!(ids, CLIENT_IDS);
    }

    #[test]
    fn cli_conflict_detection_checks_command_not_server_name() {
        assert!(!text_has_openkeylet_command(
            "openkeylet:\n  Command: C:\\tools\\other.exe\n  Args: mcp stdio"
        ));
        assert!(text_has_openkeylet_command(
            r#"{"name":"openkeylet","command":"C:\\old\\openkeylet.exe","args":["mcp","stdio"]}"#
        ));
    }

    #[test]
    fn cli_path_match_accepts_windows_verbatim_path_output() {
        let executable = Path::new(r"\\?\C:\Users\malou\openkeylet.exe");
        assert!(text_matches(
            r"Command: \\?\C:\Users\malou\openkeylet.exe
Args: mcp stdio",
            executable
        ));
        assert!(text_matches(
            r#"{"command":"\\\\?\\C:\\Users\\malou\\openkeylet.exe","args":["mcp","stdio"]}"#,
            executable
        ));
    }

    #[cfg(windows)]
    #[test]
    fn node_argv_uses_an_ordinary_windows_path() {
        assert_eq!(
            node_script_argument_path(Path::new(r"\\?\C:\Users\test\node_modules\cli.js")),
            r"C:\Users\test\node_modules\cli.js"
        );
        assert_eq!(
            node_script_argument_path(Path::new(r"\\?\UNC\server\share\cli.js")),
            r"\\server\share\cli.js"
        );
    }
}
