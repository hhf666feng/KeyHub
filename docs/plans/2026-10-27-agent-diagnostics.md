# Agent Detection Diagnostics

## Observed Failure
- The registry returns a message, configPath and installPath for every client.
- agentDetail replaces recognized error states with the generic Detection failed,
  hiding the actual reason. The local OpenClaw configuration exists but its only
  launcher is a dangling symlink to a missing ClawX.app bundle.

## Scope And Acceptance
- Preserve Agent detection/registration and all existing configuration files.
- Display a localized concrete reason for known detection errors, plus an actionable
  hint and expandable diagnostic message/configuration/CLI paths.
- Preserve unknown diagnostic text as escaped plain text, bounded and with common
  token/authorization forms redacted; never fetch configuration contents or secrets.
- Missing reasons get an explicit fallback, never an empty or undefined label.
- Keep failed rows readable, not visually disabled; only unavailable commands remain
  disabled. Chinese/English, light/dark and narrow-window layouts remain usable.

## Verification
1. Add a failing synthetic renderer test for missing CLI, timeout, invalid config,
   unknown diagnostic, missing message, escaped HTML and unchanged Agent action flags.
2. Implement presentation-only diagnostics; run localization, workspace, readability
   and targeted UI regression suites.
3. Build/package and update the local app recoverably while preserving vault data,
   pairing, existing MCP sessions and user OpenClaw configuration.
4. Native UI inspection if unlocked. Report its result separately from fixture tests.

## Result
- Local cause verified from filesystem metadata: the only launcher is a dangling
  ~/.local/bin/openclaw link to absent /Applications/ClawX.app; config file exists.
- Diagnostic UI: 8 scenarios, locale: 6 groups, workspace: 40 cases, readability:
  360 audits, brand/packaging: 33 tests pass. Syntax/version/diff checks pass.
- Built release macOS ARM64, verified archive/per-file checksums and ad-hoc signature,
  recoverably updated /Applications/KeyHub.app, preserved 16 active MCP sessions.
- OpenClaw config, vault, master key and lifecycle epoch fingerprints unchanged during
  installation. No launcher/config repair, credential retrieval or remote operation.
- Native verification PASS: updated app shows the localized missing-CLI cause; expanded
  Diagnostics shows the real backend message, config path and unavailable CLI state.
