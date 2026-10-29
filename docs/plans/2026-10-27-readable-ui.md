# Readable, consistent desktop UI

## Scope and constraints
- Preserve the accepted homepage: cool off-white canvas, white grouped panels,
  graphite commands, platform sans-serif, quiet borders and rounded controls.
- Audit vault, metadata, activity, all six settings groups, owner lock, all seven
  dialogs, inline editor, module picker, and the three menu-bar tabs.
- Presentation only; preserve IDs, native commands, drafts, privacy and permissions.
- Keep pre-existing dirty changes. No new dependencies, commits, real-vault access,
  external service calls or installation/deployment.

## Implementation
1. Add an isolated synthetic-browser regression covering computed typography,
   flat controls, viewport containment, scroll access and light/dark themes in
   Chinese/English at desktop, minimum native and narrow browser sizes.
2. Record the initial visual verdict and failing measurements before CSS edits.
3. Consolidate workspace typography to 14px body/controls, 13px help/labels,
   12px compact metadata and 20px dialog titles. Avoid shrinking at small widths.
4. Replace remaining hardware treatment on selects, switches, PIN, templates and
   secondary dialogs with existing workspace tokens. Keep switch drag geometry.
5. Align quick-panel palette and typography with the desktop; retain its compact
   dimensions and metadata-only boundary.
6. Review rendered screenshots before any follow-up visual edit. Record verdicts
   in .omx/state/readable-ui/ralph-progress.json.

## Verification and stop condition
- New computed-style and containment checks pass; inspect full desktop/mobile
  editor, settings, activity, lock and dialog screenshots in light/dark.
- Existing workspace, personal-vault, GitHub UI and quick-panel suites pass.
- Syntax and whitespace checks for changed files pass. No Rust changes/build
  required for presentation-only changes; report untested native WebView behavior.

## Completed verification
- Readability/state/containment: 360 checks passed (both themes/languages;1200x800,
  760x600,390x844). Includes PIN setup reachability, empty/error states,80-character
  confirmation titles, disabled primary actions and visible dropdown indicators.
- Desktop visual contracts:616 passed; workspace interactions:38 passed.
- Personal-vault and GitHub backup regressions:13 checks each passed.
- Quick panel:7 groups,56 readability audits passed; native contract:3 passed.
- Changed JavaScript syntax and whitespace checks passed.
- Visual verdict and artifact pointers: .omx/state/readable-ui/ralph-progress.json.
- Native Tauri/WebKit behavior remains unverified; no packaged app was installed.
