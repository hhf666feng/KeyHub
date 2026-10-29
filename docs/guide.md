# KeyHub user guide

[Product overview](../README.md) · [简体中文](guide.zh-CN.md) · [Security](../SECURITY.md)

This guide describes the current `0.16.0` source and compatibility contracts, not a newly published release.

## Vault and editing

The personal vault supports logins, cards, identities, secure notes, SSH, API and custom items, with type filters, folders and favorites. Fields remain composable. Passwords, card numbers, security codes, identity addresses and secure notes are encrypted; names, public purposes and folders remain item metadata.

The browser extension can create, edit and manually fill cards and identities from the same local vault. Autofill supports standard HTML `autocomplete`, common field names and labels, month controls, expiry formats and select options on HTTPS websites or local development addresses. It skips hidden/transparent, disabled and readonly fields; when a relevant form is focused, it fills only that form. It never submits a form or fills a different-origin frame. Lists expose only a card's last four digits. Custom payment widgets and third-party payment frames may require manual filling.

Desktop and extension password generators use the system secure random source, with 8–128 characters and selectable uppercase, lowercase, digits and symbols. Generated passwords are not retained in history.

The extension's **All vault items** panel works on browser pages as well as websites. Search and filter the full vault, edit login URLs and matching rules, organize folders and favorites, and manage cards, identities and notes. Deletion moves an item to **Trash**, where it stays until restored or permanently deleted. Trashed items cannot fill passwords or sign with passkeys. Restoring a conflicting name creates a unique name without overwriting another item.

Changing a saved password retains the latest 20 previous passwords in encrypted **Password history**. Desktop and extension views can reveal, copy or clear this history after unlocking; agents and autofill cannot request old passwords. Full vault backups include history and trash. Permanent deletion and history clearing do not remove older copies from existing backups.

There is no KeyHub account, subscription, hosted vault, or remote MCP service. KeyHub is free and open source, runs on Windows, macOS, and Linux, and keeps vault data encrypted on the current device. Optional GitHub backup stores encrypted snapshots in your own private repository. Its local `stdio` MCP starts only when an agent calls it.

## Per-module visibility

Every module has its own Agent visibility switch:

- **Hidden** — the default for credential modules. KeyHub can use the value, but it is not included in MCP responses.
- **Visible** — the value may be returned to the agent only after you explicitly enable the switch.
- **TOTP** — KeyHub derives the current six-digit code; the permanent seed is never returned.

The eye and copy controls in the editor are for the local owner. The optional six-digit PIN protects GUI plaintext viewing and extension vault access, and verifies each passkey operation. It does not replace vault encryption or disable MCP actions.

Reorder modules using the drag handle on the left, or focus a handle and press the Up/Down arrow keys. Text fields support normal typing, selection, and copying. Deleting an item, module, or draft requires confirmation; module removal takes effect when you save the item.

## Environment variable groups

Choose **Environment variables** under **Start with a combination** when creating a credential, or use **Add module → Environment variable group** in the editor, then paste one `KEY=VALUE` per line. Blank lines, full-line `#` comments, `export KEY=VALUE`, paired quotes and values containing `=` are supported. KeyHub creates one custom field per line; each key can still be edited separately. Invalid names, duplicate keys or conflicts with built-ins reject the entire paste rather than adding a partial group. Hidden values remain available to MCP `secretEnv` or `{{keyhub:KEY}}` placeholders through local injection without returning plaintext to the agent.

## Browser, SSH, and API behavior

### Browser filling

The bundled Chromium extension shares the desktop application's local encrypted vault. In **Settings → Browser Bridge**, follow the two numbered steps: **1. Open the extensions page** and turn on Developer mode; **2. Drag in the extension** by dropping the KeyHub icon onto an empty area of that page. If the page does not open automatically, enter `chrome://extensions` in Chrome's address bar. The **Can't install by dragging?** section offers a folder button for **Load unpacked**. Keep the `browser-extension` directory in place. Pairing is automatic. The fixed extension ID and existing pairing are unchanged by the rename; reload the extension after replacing its files. Re-pair if you remove the installation or reset pairing, not solely for the new display name.

Open the toolbar popup to select a login for the current website and fill its username and password. Logins without explicit website rules use the exact scheme, host and port. The desktop editor also supports multiple websites with origin, base-domain, host, exact-URL, prefix, regex and never-match rules. URL rules validate the actual target frame URL, and filling rechecks it before writing. Forms are not automatically submitted. **Save login** reads the current form and lets you confirm a new item or update an existing one. Both interfaces refresh the same vault, with stale-write detection. If a PIN is configured, the extension requires an unlock lasting five minutes. KeyHub and Browser Bridge must remain running.

Automatic save suggestions are off by default. Enable **Ask to save logins** in the popup to receive a **Review & save** notice and a `+` toolbar badge after submitting a login, registration or password-change form. The extension recognizes account fields and new passwords, ignores hidden/OTP/payment fields, and skips ambiguous or mismatched passwords. Review the source website and values in the extension window, unlock if needed, then confirm a new item or update an existing login. A submission does not prove authentication succeeded. Unchanged logins are suppressed when the vault is unlocked. Suggestions stay only in worker memory for up to five minutes; dismissing, explicitly locking from the extension, disconnecting the bridge, closing the tab, or changing to another origin clears them. Turning the option off stops collection and clears pending suggestions.

On HTTPS/local test pages, capture supports ordinary form submissions, recognizable login/registration buttons, Enter, dynamic forms, open shadow roots and same-origin frames. A username submitted through a **Next/Continue** step can accompany a subsequent password step in the same tab, frame and origin for up to two minutes; it stays in memory and is also cleared on lock, disconnect or disabling suggestions. Password filling dispatches input/change events for React controlled inputs and Vue models. Closed shadow roots, cross-origin account handoffs, ambiguous fields and custom buttons without recognizable labels may still need manual entry or **Save login**.

Passkey creation and sign-in open an extension confirmation window. A new passkey is stored as a separate vault item. Private keys remain encrypted in the desktop vault; only registration data and assertion signatures reach the browser. Websites requiring user verification need a KeyHub PIN, verified afresh for each passkey request. **Use device** returns to the native browser flow. The desktop editor shows the passkey's account and relying party; moving that item to trash disables the passkey until restored. Permanent deletion removes the local credential.

This version supports top-level HTTPS pages (and local `localhost`), ES256, discoverable credentials and allow-list sign-in. Cross-origin frames, conditional autofill, hardware attestation and advanced WebAuthn extensions use the native path where supported. Existing passkeys from other providers are not automatically imported.

The Agent's `credential_fill` path still writes one selected value into the focused control and can submit its form with explicit `submit=true`. That path does not apply the popup's website matching. KeyHub does not export cookies.

### SSH

KeyHub supports password and private-key authentication, unrestricted-length commands and output, direct stdin, and recursive SFTP upload/download. Host, port, and username may be saved as defaults or supplied for the current task. Destination parent directories are created automatically and existing file or directory targets are replaced only after a complete temporary copy is ready. KeyHub does not pin or compare SSH host fingerprints. Authentication plaintext is not returned to the agent.

### HTTP APIs

KeyHub recognizes common API providers and Basic combinations, and falls back to Bearer Token when no provider matches. A saved service URL is a default and relative-path base, not an Origin restriction; the agent may use any HTTP/HTTPS destination required by the task. Other protocols can place `{{keyhub:module name}}` placeholders in the URL, headers, query, JSON/text body, or form values, and KeyHub resolves them locally. Redirects are followed, responses have no default size limit and may stream directly to a local file, and multipart uploads are supported.

## Local app controls

On macOS, click the KeyHub menu bar icon for a compact panel with credential-name
search, Agent connections, recent activity, full-window access, lock and quit.
Escape or clicking outside dismisses it. It displays metadata only; configured
PIN locking removes credential and activity lists from the panel snapshot.

Enable **Settings → Window & lock → Menu bar only** to hide the Dock icon and
start with the full window hidden. The panel and reopening the app in Finder
still open the full workspace. Disable the setting to restore the Dock entry.
If the tray cannot initialize, the main window and Dock remain available.
The settings page also provides an **Open quick panel** preview button.

The Settings page includes:

- desktop shortcut (where supported) and launch-at-login controls;
- close-to-tray or quit behavior;
- optional six-digit local PIN;
- Agent connection and repair;
- Browser Bridge pairing;
- encrypted backup import/export and direct access to the local data folder.

Replacing or upgrading the executable does not remove your vault. KeyHub intentionally reuses the current OS user's data directory:

| Platform | Vault location |
| --- | --- |
| Windows | `%APPDATA%\mcp-vault\v2` |
| macOS | `~/Library/Application Support/mcp-vault/v2` |
| Linux | `${XDG_DATA_HOME:-~/.local/share}/mcp-vault/v2` |

Desktop `.mvault` exports use a separate backup password (at least 12 characters), Argon2id (64 MiB, 3 iterations, 1 lane), and XChaCha20-Poly1305. The file contains no unlock key; restoration requires the password. Older and current CLI automatically unlocked packages remain importable but contain their own unlock material and must be protected like the original credentials.

## Migration and compatibility

See the [rename compatibility table and Agent repair steps](../README.md#migration-and-capability-parity).

Compatibility identifiers are not display branding. Keep the application ID `dev.kru.desktop`, local secret AAD `mcp-vault/secret/v2`, portable format `mcp-vault-portable`, and the existing versioned `kru/backup/v3` through `kru/backup/v8` AAD unchanged. GitHub snapshots retain filename `openkeylet.vault.json`, format `openkeylet-cloud-backup` and AAD `openkeylet/cloud-backup/v1`; local GitHub device state retains `openkeylet-github-device`. The complete container identifiers are listed in the [security policy](../SECURITY.md#local-data-and-backups).

Current macOS builds use an application-private `master.key` in the data directory, with directory permissions `0700` and key-file permissions `0600`. When an existing vault has no file key, startup tries to read the legacy Keychain entry `mcp-vault` / `master-key-v2` without displaying an authorization prompt, then migrates it into the file. If unavailable, it refuses to generate a replacement key for existing data. To explicitly authorize access to the old Keychain item, use the installed executable:

```sh
/Applications/KeyHub.app/Contents/MacOS/keyhub key migrate
```

This command may trigger system authorization; adjust the path for your installation. Windows/Linux prefer system credential storage under the same service/account, with a local permissions-protected key file as fallback. The PIN is not the master key. Do not delete `master.key` to troubleshoot, or treat the data directory or self-unlocking exports as safe to publish.

## GitHub encrypted backup

In **Settings → GitHub backup**, connect a private repository that you own:

1. Choose **Set up GitHub backup** and select authorization. Reuse an existing [GitHub CLI login](https://cli.github.com/manual/gh_auth_login), or supply a [fine-grained GitHub token](https://github.com/settings/personal-access-tokens/new). Installing Git alone does not sign you into GitHub.
2. Choose **Check account**, verify the account, and enter `owner/repository`. For an existing private repository, grant the token **Contents: Read and write** for that repository.
3. To create a repository, select **Create this private repository in my account**. This requires repository creation authorization (**Administration: Write** for fine-grained tokens). Create organization repositories on GitHub first. An existing repository is never adopted or made private automatically; uncheck creation to connect one you already own.
4. Choose **Create a new backup**, generate a recovery key, and acknowledge saving it outside the repository. Leave **Upload the first encrypted backup after connecting** selected to use **Connect & upload**, or deselect it to save the connection and upload later.
5. On another device, choose **Connect an existing backup**, provide authorization, the same repository and the original recovery key, then choose **Restore**. Upload is disabled until restoration completes.

GitHub CLI authorization is read only when you check the account or submit the connection. Its token never enters the renderer or logs and is stored encrypted locally after connecting. A failed first upload retains the connection so you can retry without recreating the repository. If repository creation cannot be confirmed, check GitHub before reconnecting.

The entire portable payload, including item names, addresses, notes and credentials, is encrypted locally with XChaCha20-Poly1305 and a separate random 256-bit recovery key. GitHub receives `openkeylet.vault.json` without any unlock key. The token and recovery key are encrypted under the device's local vault key and never included in backups. Browser pairing, PIN, agent configuration, activity logs and editor drafts stay local. You can view the saved recovery key from the unlocked GUI.

Snapshot encryption protects confidentiality and integrity, not availability or cryptographic rollback resistance. A repository owner can later expose or delete the repository; anyone holding a recovery key and a snapshot can decrypt that snapshot.

This first version provides **manual snapshots and merge restore**, not automatic two-way synchronization. Restoring skips identical items and keeps conflicting items separately; it never deletes or overwrites local items. A newly connected device must restore an existing snapshot before uploading. Remote version changes and concurrent writes stop the upload instead of forcing an overwrite. Repository privacy is checked before every upload and restore. GitHub.com repositories are supported, with an 8 MiB encrypted snapshot limit.

Keep the recovery key: without it or a still-connected device, a backup cannot be recovered. Git history retains older encrypted snapshots, including deleted credentials. Disconnecting removes this device's saved connection only; it does not delete repository history or revoke the GitHub token. Legacy and CLI self-unlocking `.mvault` exports must not be uploaded as cloud-safe encrypted backups.

## Format versions and importing other vaults

New backups contain v8 portable data, including item types, folders, favorites, website rules, passkeys, password history and trash; v3/v4/v5/v6/v7 backups remain importable. Existing v7/v8/v9/v10/v11 vaults remain readable and are saved as v12 on the next modification. Older applications cannot read v12 vaults, password-protected backup containers or v8 portable data.

Use **System → Local data → Import vault** to migrate Bitwarden unencrypted JSON or Chrome/Edge password CSV. A count-and-compatibility preview precedes the import. Cancelling makes no vault changes; confirming merges all records transactionally and deduplicates identical entries without overwriting existing items. The selected file is read only once; the pending preview payload is encrypted in memory and expires after five minutes.

Bitwarden import preserves logins, cards, identities, secure notes, SSH keys, folders, favorites, notes, custom fields and multiple website rules. ES256/P-256 PKCS#8 passkeys are converted locally, including credential IDs, user handles and counters. Legacy nonzero counters increment under the vault lock before a signature is returned; avoid continuing to use another copy of those credentials. Standard Base32 and `otpauth://totp` secrets support SHA-1/SHA-256/SHA-512, 6–8 digits and configurable periods. Unsupported TOTP seeds are retained with a preview warning.

The preview explains remaining migration differences: attachments need separate transfer; linked fields are retained as encrypted custom fields; the latest 20 source passwords enter password history, with longer histories additionally archived in an encrypted custom field. Per-item master-password reprompt and organization sharing permissions do not transfer. Deleted source records are skipped. Unsupported item types, invalid keys or invalid records fail without writing a partial import. Source exports are not deleted or modified.

## MCP calling conventions

KeyHub exposes all 12 MCP tools listed below and uses unique item names directly instead of exposing internal UUIDs. If the user has already named the item and the action is clear, the agent can call that action immediately. An explicit item or a unique `items_search` result becomes lightweight context for the current MCP session, so compatible fill, SSH, transfer, HTTP, and terminal calls can omit the repeated name. Natural phrases such as `use Production Server in KeyHub MCP` are understood. Discovery remains available for lookup, switching, module inspection, and ambiguity. Hidden plaintext must never be requested from the user, and unknown fields or retired tool names are rejected.

Each agent session owns its stdio MCP process. Starting a newer KeyHub build or another agent session does not interrupt work already in progress; sessions end when their client disconnects or the user explicitly quits KeyHub from the tray.

After installing an updated binary, start a new agent/client session to discover `items_create`; an existing stdio process does not gain new tools just because the desktop app was updated. This guide does not establish that the updated binary is installed or that a client has loaded it.

| Tool | Purpose | MCP impact hint |
| --- | --- | --- |
| `items_search(query?)` | Find enabled items, including incomplete skeletons, modules, and advertised actions | Read-only, idempotent, local |
| `items_create` | Create a new skeleton with blank, hidden secret slots and optional public targets | Changes local vault state; duplicate names fail, never overwrite |
| `credential_fill` | Use one saved module in the focused local target, optionally submitting it | Changes local state; submission can have external effects |
| `terminal_run` | Run a one-shot local shell command with optional stdin and hidden-module substitution | Local or external effects possible |
| `ssh_run` | Run a command through a saved identity and saved or runtime SSH target | External effects possible |
| `ssh_upload` | Recursively upload a local file or directory through a saved identity | Reads a local path and changes the remote target |
| `ssh_download` | Recursively download a remote file or directory through a saved identity | Reads a remote path and changes the local target |
| `http_send` | Send an authenticated HTTP request, optionally transferring local files | External and local-file effects possible |
| `terminal_start` | Start a managed local process | Changes local state |
| `terminal_write` | Write ordinary input into a managed terminal | External effects possible |
| `terminal_read` | Read redacted managed-terminal output | Read-only, idempotent, local |
| `terminal_stop` | Close a managed terminal session | Idempotent state change |

Ordinary commands, scripts, JSON, or configuration can be passed directly through `terminal_run.stdin` or `ssh_run.stdin`, avoiding shell escaping and temporary files. Commands, stdin, paths, PTY input, and HTTP request fields can reference hidden modules with `{{keyhub:module name}}`. Local paths accept absolute, home-relative, and MCP-workspace-relative forms. KeyHub imposes no fixed limit on command length, SSH or terminal output, module count, or concurrent terminal count; callers may still opt into explicit time or response-size limits.

Every successful tool call returns typed `structuredContent` and equivalent JSON text. Business failures return an MCP tool result with `isError=true`; malformed protocol input remains a protocol error. Tool annotations help clients describe impact, but all real security restrictions are enforced by KeyHub's backend.

There is no unrestricted `get_secret` tool. `items_search` returns item and module metadata plus advertised actions. A credential value is included only when its Agent visibility switch is on.

### Create a credential skeleton

Use `items_create` to prepare the fields, not to import or disclose secrets. Its arguments are:

| Field | Contract |
| --- | --- |
| `name` | Required unique item name |
| `description`, `folder`, `itemType` | Optional public metadata; never put secrets here. Supported item types are `login`, `card`, `identity`, `secureNote`, `ssh`, `api`, and `custom`; omission lets the validator infer the type |
| `modules` | Required array of module objects with `kind`, optional `name` for `customSecret`, and optional `value` only for public `host`, `port`, or `url` targets; `customSecret` requires a valid unique field name |

Core module kinds are `username`, `password`, `apiCredential`, `privateKey`, `passphrase`, `totp`, `customSecret`, `host`, `port`, and `url`. Existing personal card, identity and `secureNote` field kinds are also accepted by the same validator. All credential and personal fields, including usernames, must be left blank for the owner; only the public target kinds may carry a `value`. Omit `value` entirely for secret slots. Passkeys cannot be authored through this tool; use the browser's supported registration flow.

There is no `id`, update/delete operation, `agentVisible` override, or caller-controlled enabled flag. Secret slots are forced hidden and the new item is enabled. Validation and unique-name creation are atomic: a duplicate name fails rather than overwriting, updating, or partially creating an item. Being enabled does not make empty secrets usable.

For an ASR service, call `items_create` with arguments such as:

```json
{
  "name": "ASR API",
  "description": "Speech-to-text service",
  "folder": "AI services",
  "itemType": "api",
  "modules": [
    { "kind": "url", "value": "https://asr.example.com" },
    { "kind": "apiCredential" }
  ]
}
```

The example URL is illustrative, not a verified service. The successful response contains `created: true`, `item: {name, modules, actions}`, `requiresOwnerInput`, `missingFields`, and `nextStep`. Each module reports `{kind, name, configured, agentVisible, value?}`; public target values may appear, but hidden secret values do not. Here the blank `apiCredential` is unconfigured and hidden, `actions` is `[]`, and `requiresOwnerInput` is `true`; `missingFields` and `nextStep` tell the owner what to complete.

The owner opens **ASR API** in the KeyHub GUI, unlocks the owner interface if a PIN is configured, fills the API credential locally, leaves Agent visibility off, and saves. The agent can then search the item again and use its advertised `http_send` action without receiving the token. Until usable credentials are configured, `items_search` still returns the enabled skeleton with `actions: []`; disabled items remain excluded. Search presence and `created: true` do not prove API connectivity or successful authentication.

The owner PIN does not block MCP actions: skeleton creation is a local vault write, not access to the GUI's owner-only secret viewing/filling controls. Never ask the owner to paste the token into chat or send it as an `items_create` argument. See [security boundaries](../SECURITY.md#credential-skeleton-creation).

For manual client configuration, see the [README](../README.md#quick-start).

## Development and verification

`npm run test:unit` runs offline Node unit/contract checks. `npm run test:ui`
runs synthetic UI suites sequentially using Playwright's Chromium by default;
set `PLAYWRIGHT_CHANNEL=chrome` to use an installed Chrome where supported.
`npm run lint` checks JavaScript syntax and version consistency, not semantic
JavaScript types. Rust types and lints are checked by Cargo check and Clippy.

Browser integration tests load the real unpacked extension in an isolated Chromium profile and use a temporary vault with fixture credentials. After installing Playwright's Chromium (`npx playwright install chromium`), run `npm run test:browser`. Configure `PLAYWRIGHT_BROWSERS_PATH`, `CARGO_TARGET_DIR` and your temporary directory to match your environment policy. These tests cover password synchronization, independently verified passkey registration/signatures and cancellation; native desktop-to-Chrome dragging still needs a manual check.

Login compatibility checks are available through `npm run test:login-patterns -- --all-browsers` (Chromium plus installed Chrome and Edge), `npm run test:login-flows` (real extension, React/Vue components, dynamic forms and multi-step flows), and `npm run test:login-capture` (confirmation, history, privacy and origin boundaries). `npm run test:public-logins` optionally inspects public GitHub, Google, Microsoft and GitLab login-page field structures without entering credentials or submitting forms. A successful structural probe or fixture-based test is not certification of a live website's authentication flow; challenges and inaccessible pages are reported as unverified.

Common build, unit-test and static-check commands are in the [README](../README.md#development-and-builds). `test:ui` uses Playwright and requires Chromium to be installed first. Native menu-bar focus, extension drag installation, operating-system permissions, and signing/notarization still need target-platform verification; passing mocked UI or packaging fixtures does not replace those checks.
