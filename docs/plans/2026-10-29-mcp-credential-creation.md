# MCP Credential Skeleton Creation

## Goal

Let an agent prepare an ASR/API/login/SSH/custom credential entry while the owner
enters actual secret values locally. Do not ask for plaintext in chat.

## Contract

- Add `items_create`, accepting a unique name, optional public metadata and a
  required module list. Public host/port/URL values may be provided.
- Every credential or personal field stays empty and hidden. Reject secret
  values, unknown properties, visibility overrides, ids and secret bundles.
- Reuse the vault's existing transaction, normalization and encryption; duplicate
  names fail atomically, including concurrent requests. No overwrite or deletion.
- Search enabled skeletons even before capabilities exist; disabled items remain
  absent, and existing capability checks still guard credential actions.
- Return metadata, missing fields and local completion instructions, not secrets.
- No new vault schema, permission boundary, passkey ceremony or dependency.

## Verification

Tests precede implementation: missing tool/types failed compilation first.
Targeted coverage includes persistence, empty secrets, forced visibility, PIN
independence, concurrent duplicates, validation/no partial writes, unknown fields,
and owner completion followed by normal action discovery. Verify all binary
aliases through real stdio with isolated temporary vaults and no personal data.

Documentation is authored separately from implementation. A separate read-only
review checks the creation boundary. Run Node suites, Rust full/headless tests,
Clippy and formatting. Publish only scoped files, preserving unrelated edits.

## Local Delivery

Keep a recoverable copy of the installed app. Replace executables atomically and
re-sign the existing ad-hoc app without restarting existing MCP sessions. Existing
processes retain their old tool list; a new client session discovers the new tool.
Do not create an ASR record in the owner's real vault as part of verification.

## Review Corrections

- A selected incomplete item must fail closed rather than silently falling back
  to another item's configured credentials. Covered after creation and search.
- Sanitize creation deserialization and validation errors at the boundary so
  malformed argument values and module identifiers are not echoed by rmcp.
- Owner-completed API skeletons reuse automatic Bearer auth configuration, remain
  hidden, and advertise normal HTTP actions only after values are saved.

## Verification Results

- 202 GUI-feature and 143 headless Rust tests pass with bounded test concurrency.
- All 80 Node unit/contracts, syntax/version, Rustfmt and strict Clippy pass.
- Native GUI presentation is unchanged; target-platform release packaging and
  live external API authentication are outside this feature's verification.
- Release and installed macOS binaries (canonical plus both legacy aliases)
  expose 12 tools and pass real stdio creation, duplicate, blank-field discovery,
  malformed-input sanitization, schema and shell smoke checks using temp vaults.
- Installed executables were atomically replaced and the app ad-hoc re-signed,
  with a recoverable prior bundle retained. Vault/master-key/epoch fingerprints
  remained unchanged; existing sessions were not stopped. New sessions are needed.
