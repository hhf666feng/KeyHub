# Desktop Localization And Extension Visual Parity

**Goal:** Chinese desktop mode must not leave application-owned English status
or action labels behind. The browser companion should match KeyHub's current
neutral, rounded, readable client instead of the legacy hardware theme.

## Boundaries
- Preserve every command, permission, fixed extension ID/key, pairing/storage
  identifier, protocol, credential action and backup format.
- Product/provider names and literal APIs/paths remain unchanged. Application
  status/action words are translated, including Agent rows, bridge status, lock,
  editor empty/private-key controls and quick-panel enum labels.
- Extension language can be selected explicitly (Chinese/English), persisted in
  extension-owned settings and defaults from browser language. No new permissions
  or secret storage. Theme uses system preference plus explicit local choice.
- Popup, capture window, vault editor/history/trash and passkey confirmation
  keep all existing selectors and behavior while sharing the new visual tokens.

## Execution
1. Add failing desktop language tests with synthetic Agent states and lock/editor
   flows. Translate only presentation, not enums or stored values.
2. Parallel extension lane: update presentation assets and localized strings,
   add synthetic UI tests for state variants and responsive/light/dark/zh/en.
3. Review snapshots before visual iteration; update brand freeze tests to account
   for the explicitly authorized UI changes while retaining protocol/identity gates.
4. Run desktop regressions plus browser pairing/fill/capture/passkey/vault suites.
5. Build/sign locally, update the installed app recoverably without stopping MCP
   sessions. Inspect the installed extension source path before refreshing files.
   Reload only the existing KeyHub unpacked extension; do not reinstall, reset
   pairing, broaden permissions or copy credentials.
6. Verify native Chinese Agent page and the real browser extension UI. Report any
   reload limitation separately from source/build/test success.
