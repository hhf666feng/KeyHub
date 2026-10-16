<p align="center">
  <img src=".github/assets/openkeylet-hero.svg" alt="OpenKeylet local MCP password and credential manager for AI agents" width="100%" />
</p>

<h1 align="center">OpenKeylet — Local password and credential manager for AI agents</h1>

<p align="center">
  <strong>A local MCP credential relay that keeps agent workflows moving without exposing hidden plaintext.</strong>
</p>

<p align="center">
  Local only&nbsp;&nbsp;·&nbsp;&nbsp;Free and open source&nbsp;&nbsp;·&nbsp;&nbsp;No account&nbsp;&nbsp;·&nbsp;&nbsp;Windows / macOS / Linux
</p>

<p align="center">
  <a href="../../releases/latest"><strong>Download</strong></a>
  &nbsp;&nbsp;·&nbsp;&nbsp;
  <a href="README.zh-CN.md">中文</a>
  &nbsp;&nbsp;·&nbsp;&nbsp;
  <a href="SECURITY.md">Security</a>
</p>

---

OpenKeylet is a free, open-source, cross-platform password manager, credential vault, and local `stdio` MCP server for AI agents. It lets MCP clients such as Codex, Claude Code, Cursor, OpenCode, and OpenClaw use saved passwords, API credentials, SSH keys, TOTP codes, and custom secrets while hidden plaintext stays outside the normal model context.

Use OpenKeylet when an agent needs to sign in to a website, connect to a server, call an authenticated API, or finish a terminal prompt without asking you to paste a secret into the conversation.

**Previously KRU.** OpenKeylet keeps the same local vault, encryption keys, browser pairing, and `.mvault` backup format. Existing `{{kru:module}}` placeholders and `KRU_DATA_DIR` / `KRU_LAUNCHER_PATH` environment variables remain supported; use `{{openkeylet:module}}` and `OPENKEYLET_*` for new setups. After upgrading, open **Settings → Agent connection → Repair** to migrate a managed `kru` MCP entry to `openkeylet` and update its executable path, then start a new agent session. Existing desktop and startup shortcuts are migrated when the new GUI starts.

## Use OpenKeylet like this

Once OpenKeylet is connected, describe the task normally. Include the unique OpenKeylet item name for the most reliable match, or simply tell the agent to check OpenKeylet when authentication is needed.

| Goal | Example |
| --- | --- |
| **Server task** | `Use "Production Server" in OpenKeylet MCP to deploy the current build and verify the service.` |
| **Authenticated API** | `Use "DNS Provider" in OpenKeylet MCP to list the domains in this account.` |
| **Browser sign-in** | `Open the admin console. When credentials are required, use "Admin Account" in OpenKeylet MCP.` |
| **Automatic lookup** | `Continue the task. If authentication is required, check OpenKeylet first.` |

The quoted text is the item name saved in OpenKeylet. If you omit it, the agent can inspect OpenKeylet's item list and choose a match.

## What OpenKeylet does

OpenKeylet is a small local MCP tool for saving and using credentials without breaking an agent's workflow. The agent controls the task, while OpenKeylet performs credential operations locally—filling a focused field, running local or SSH commands, transferring files and directories, or sending authenticated API requests.

OpenKeylet stores credentials as independent modules rather than fixed “login / SSH / API” item types. Username, password, API credential, private key, key passphrase, TOTP, host, port, URL, and custom fields can be combined in one item. The available MCP actions are derived automatically from that combination.

There is no OpenKeylet account, subscription, cloud vault, or remote MCP service. OpenKeylet is free and open source, runs on Windows, macOS, and Linux, and keeps vault data encrypted on the current device. Its local `stdio` MCP starts only when an agent calls it.

<table>
  <tr>
    <td width="33%"><strong>01 / STORE</strong><br><br>Save only the modules the item needs. Values are encrypted locally.</td>
    <td width="33%"><strong>02 / DISCOVER</strong><br><br>The agent sees item names, field names, non-secret targets, and available actions.</td>
    <td width="33%"><strong>03 / USE</strong><br><br>OpenKeylet performs the selected credential action locally without returning hidden plaintext.</td>
  </tr>
</table>

<p align="center">
  <img src=".github/assets/openkeylet-flow.svg" alt="AI agent finds a credential item and OpenKeylet uses the hidden secret locally" width="100%" />
</p>

## Start in three steps

1. **Download and open OpenKeylet**
   Choose the portable build for your platform. No registration is required.

2. **Connect your agent**
   Open **Settings → Agent connection**, connect a detected client, then start a new agent session.

3. **Save an item**
   Give it a unique name and add only the modules you need. You can start from a preset or build the item module by module.

OpenKeylet registers a local `stdio` MCP command. The MCP process starts on demand when the agent calls it.

## MCP client compatibility

OpenKeylet's Agent connection screen can detect, connect, and repair local configuration for **Codex**, **Claude Code**, **Cursor**, **OpenCode**, and **OpenClaw**. Other AI assistants and coding agents can connect through the manual configuration below whenever they support a local `stdio` MCP server.

## One item, several actions

| Action | When OpenKeylet advertises it | What happens locally |
| --- | --- | --- |
| **Fill** | The item contains a credential module | OpenKeylet writes the selected value into a focused browser, desktop control, or managed terminal |
| **SSH** | The item contains a password or private key | OpenKeylet authenticates locally; the host, port, and username can be saved defaults or supplied for the task |
| **File transfer** | The item contains a password or private key | OpenKeylet recursively uploads or downloads files and directories over SFTP |
| **HTTP** | The item contains any configured secret | OpenKeylet injects built-in authentication or resolves hidden-module placeholders locally |
| **Terminal** | The agent runs a local command or opens a managed terminal | OpenKeylet can substitute hidden modules without returning them to the agent |

An item may advertise more than one action. OpenKeylet has no observation, diagnostic, restricted, or execution mode: if `ssh_run` is available, the agent sends the command the task actually requires.

## Plaintext visibility is per module

Every module has its own Agent visibility switch:

- **Hidden** — the default for credential modules. OpenKeylet can use the value, but it is not included in MCP responses.
- **Visible** — the value may be returned to the agent only after you explicitly enable the switch.
- **TOTP** — OpenKeylet derives the current six-digit code; the permanent seed is never returned.

The eye and copy controls in the editor are for the local owner. The optional six-digit PIN locks plaintext viewing in the GUI; it does not replace vault encryption and does not disable MCP actions.

Reorder modules using the drag handle on the left, or focus a handle and press the Up/Down arrow keys. Text fields support normal typing, selection, and copying. Deleting an item, module, or draft requires confirmation; module removal takes effect when you save the item.

## Built for local use

<table>
  <tr>
    <td width="33%"><strong>Encrypted vault</strong><br><br>XChaCha20-Poly1305 protects stored fields. The machine key stays local.</td>
    <td width="33%"><strong>Portable backup</strong><br><br>Export an encrypted <code>.mvault</code> package and import it on another device.</td>
    <td width="33%"><strong>Auditable</strong><br><br>Local activity records show which client requested which action without logging secret values.</td>
  </tr>
</table>

## Browser, SSH, and API behavior

### Browser filling

Reliable unattended browser filling uses the bundled Chromium extension. OpenKeylet writes one selected field into the currently focused control; when the agent explicitly sets `submit=true`, it can submit that field's form in the same call. It does not inspect the page, choose a field, or export cookies. Chrome, Edge, and Brave require one manual extension load on first use.

### SSH

OpenKeylet supports password and private-key authentication, unrestricted-length commands and output, direct stdin, and recursive SFTP upload/download. Host, port, and username may be saved as defaults or supplied for the current task. Destination parent directories are created automatically and existing file or directory targets are replaced only after a complete temporary copy is ready. OpenKeylet does not pin or compare SSH host fingerprints. Authentication plaintext is not returned to the agent.

### HTTP APIs

OpenKeylet recognizes common API providers and Basic combinations, and falls back to Bearer Token when no provider matches. A saved service URL is a default and relative-path base, not an Origin restriction; the agent may use any HTTP/HTTPS destination required by the task. Other protocols can place `{{openkeylet:module name}}` placeholders in the URL, headers, query, JSON/text body, or form values, and OpenKeylet resolves them locally. Redirects are followed, responses have no default size limit and may stream directly to a local file, and multipart uploads are supported.

## Local app controls

The Settings page includes:

- desktop shortcut (where supported) and launch-at-login controls;
- close-to-tray or quit behavior;
- optional six-digit local PIN;
- Agent connection and repair;
- Browser Bridge pairing;
- encrypted backup import/export and direct access to the local data folder.

Replacing or upgrading the executable does not remove your vault. OpenKeylet intentionally reuses the current OS user's data directory:

| Platform | Vault location |
| --- | --- |
| Windows | `%APPDATA%\mcp-vault\v2` |
| macOS | `~/Library/Application Support/mcp-vault/v2` |
| Linux | `${XDG_DATA_HOME:-~/.local/share}/mcp-vault/v2` |

Exported `.mvault` packages are encrypted and portable, but they contain their own unlock material for easy import. Protect a backup file as carefully as the original credentials.

New exports use the leaner v4 backup format. Existing v3 backups can still be imported; v4 backups require an OpenKeylet version that supports that format. Existing v7 vaults remain readable and are saved as v8 on their first modification, preserving existing credentials. After this format upgrade, start new Agent sessions so they use the updated OpenKeylet; older versions cannot read v8 vaults.

## Common questions

### Is OpenKeylet a password manager for AI agents?

Yes. OpenKeylet combines a locally encrypted credential vault with an MCP server that agents can call when a task reaches an authentication step. It is designed for AI coding agents, terminal agents, and other local MCP clients.

### Does OpenKeylet give my password to the LLM?

Not by default. Hidden modules are used locally by OpenKeylet and are excluded from MCP responses and normal model context. You can explicitly make an individual module visible when a workflow genuinely requires the value.

### What credentials can OpenKeylet store and use?

OpenKeylet supports usernames, passwords, API keys and tokens, SSH private keys and passphrases, TOTP seeds, hosts, ports, service URLs, and custom fields. Modules can be combined freely in one item.

### Does OpenKeylet require a cloud account?

No. OpenKeylet is a local-first, account-free secrets manager. The app, vault, MCP server, activity records, and backups remain under your control on the current device.

## Downloads

| Target | Package | Notes |
| --- | --- | --- |
| Windows x64 | `.zip` | Portable GUI, tray, desktop input, and browser extension |
| macOS arm64 | `.zip` | Native `.app`; Accessibility permission is required for desktop input |
| Linux x64 GUI | `.tar.gz` | AppImage GUI; desktop input supports X11 |
| Linux x64 headless | `.tar.gz` | No WebView dependency; MCP, SSH, HTTP, terminal, backup, and browser bridge |

<p align="center">
  <a href="../../releases/latest"><strong>OPEN LATEST RELEASE →</strong></a>
</p>

<details>
  <summary>Watch the short product demo</summary>
  <p><a href="https://www.youtube.com/watch?v=GKQLEgAdbTU">OpenKeylet demo on YouTube →</a></p>
</details>

## MCP surface

OpenKeylet 0.15 uses unique item names directly instead of exposing internal UUIDs. If the user has already named the item and the action is clear, the agent can call that action immediately. An explicit item or a unique `items_search` result becomes lightweight context for the current MCP session, so compatible fill, SSH, transfer, HTTP, and terminal calls can omit the repeated name. Natural phrases such as `use Production Server in OpenKeylet MCP` are understood. Discovery remains available for lookup, switching, module inspection, and ambiguity. Hidden plaintext must never be requested from the user, and unknown fields or retired tool names are rejected.

Each agent session owns its stdio MCP process. Starting a newer OpenKeylet build or another agent session does not interrupt work already in progress; sessions end when their client disconnects or the user explicitly quits OpenKeylet from the tray.

| Tool | Purpose | MCP impact hint |
| --- | --- | --- |
| `items_search(query?)` | Find usable items, modules, and advertised actions | Read-only, idempotent, local |
| `credential_fill` | Use one saved module in an approved local target, optionally submitting it | Changes local state; submission can have external effects |
| `terminal_run` | Run a one-shot local shell command with optional stdin and hidden-module substitution | Local or external effects possible |
| `ssh_run` | Run a command through a saved identity and saved or runtime SSH target | External effects possible |
| `ssh_upload` | Recursively upload a local file or directory through a saved identity | Reads a local path and changes the remote target |
| `ssh_download` | Recursively download a remote file or directory through a saved identity | Reads a remote path and changes the local target |
| `http_send` | Send an authenticated HTTP request, optionally transferring local files | External and local-file effects possible |
| `terminal_start` | Start a managed local process | Changes local state |
| `terminal_write` | Write ordinary input into a managed terminal | External effects possible |
| `terminal_read` | Read redacted managed-terminal output | Read-only, idempotent, local |
| `terminal_stop` | Close a managed terminal session | Idempotent state change |

Ordinary commands, scripts, JSON, or configuration can be passed directly through `terminal_run.stdin` or `ssh_run.stdin`, avoiding shell escaping and temporary files. Commands, stdin, paths, PTY input, and HTTP request fields can reference hidden modules with `{{openkeylet:module name}}`. Local paths accept absolute, home-relative, and MCP-workspace-relative forms. OpenKeylet imposes no fixed limit on command length, SSH or terminal output, module count, or concurrent terminal count; callers may still opt into explicit time or response-size limits.

Every successful tool call returns typed `structuredContent` and equivalent JSON text. Business failures return an MCP tool result with `isError=true`; malformed protocol input remains a protocol error. Tool annotations help clients describe impact, but all real security restrictions are enforced by OpenKeylet's backend.

There is no unrestricted `get_secret` tool. `items_search` returns item and module metadata plus advertised actions. A credential value is included only when its Agent visibility switch is on.

Manual `stdio` configuration:

```json
{
  "mcpServers": {
    "openkeylet": {
      "command": "C:\\absolute\\path\\to\\openkeylet.exe",
      "args": ["mcp", "stdio"]
    }
  }
}
```

OpenKeylet can also print client-ready configuration:

```text
openkeylet config stdio-json
openkeylet config stdio-toml
```

## Security model

OpenKeylet is designed to keep hidden values out of normal MCP parameters, responses, activity records, application logs, and LLM API traffic. The OpenKeylet process and the final target necessarily handle plaintext briefly while an action runs.

OpenKeylet is not a sandbox. It does not defend against a malicious agent, a compromised machine or browser, or another process running as the same OS user. It cannot determine whether the agent focused the correct input or chose a trustworthy target. Read the complete [security policy and threat boundary](SECURITY.md) before relying on OpenKeylet for sensitive infrastructure.

## Build from source

Requirements: Rust 1.88+, Node.js 22+, and the [Tauri 2 platform prerequisites](https://v2.tauri.app/start/prerequisites/).

```bash
npm install
npm run check
npm test
npm run build
npm run portable
```

Additional release targets:

```bash
npm run release:mac
npm run release:linux
npm run release:headless
```

## License

[MIT](LICENSE) — use it, inspect it, and improve it.
