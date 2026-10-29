# Design

Product: KeyHub (formerly OpenKeylet / KRU). Keep the accepted local Magpie-inspired
visual language and every existing credential capability; this is a compatible rename.

## Source of truth
- Status: Active
- Last refreshed: 2026-10-27
- Menu-bar panel added: 2026-10-27, following the supplied Magpie popover reference.
- Primary product surfaces: desktop credential workspace; existing owner dialogs.
- Evidence reviewed: renderer/index.html, renderer/app.js, renderer/styles.css,
  renderer/bricktone*.css, src-tauri/src/commands.rs, SECURITY.md and renderer tests;
  user-supplied screenshots and the live local /Applications/magpie.app
  (com.yetone.magpie), inspected on Agent, resource library and general settings.
- Reference correction: the unrelated Blinue/Magpie Windows upscaler was the wrong
  reference. Do not use its WinUI styling, blue active rail or square controls.

## Brand
- Personality: understated native utility following the local Magpie Agent manager.
- Trust signals: real service state and explicit agent visibility, not security scores.
- Avoid: SaaS dashboards, marketing slogans, large metric cards, serif display headings,
  green-tinted surfaces, tiny hardware lettering, glowing controls and fake permissions.
- Brand mark: a key-bow and stem form a K with two rounded branches. Graphite
  (#25282D), warm ivory (#F9F6EE) and amber (#F1A24A) replace the small network glyph.
  Keep the bilingual UI and familiar credential editor controls.

## Product goals
- Make finding a credential, understanding its exposure and connecting an agent obvious.
- Separate metadata inspection from explicit plaintext editing.
- Non-goals: changing encryption, MCP policies or agent permissions.
- Success signals: visible search, usable folders/favorites, readable details, no lost drafts.

## Personas and jobs
- Primary persona: local AI-agent user maintaining API tokens, SSH keys and logins.
- Jobs: find a key; inspect its available actions; edit safely; connect an agent; review logs.
- Context: desktop first, with small-window and keyboard access.

## Information architecture
- Persistent sidebar: vault, activity, settings; all items, favorites and real folders.
- Vault: practical page title, compact search/add command bar, labeled type filters,
  list and metadata inspector. Real counters and connection states live in a status bar.
- Settings: preserve all native commands and section filters; direct Agent setup shortcut.
- Details never automatically call owner_secret_view or display stored credential values.

## Design principles
- Show real state; never imply hidden means inaccessible or that PIN blocks MCP actions.
- Select to inspect metadata; explicitly edit to access the existing owner editor.
- Reuse existing CRUD, revision checks, draft handling, confirmation and lock flow.
- Tradeoff: keep inline editing compatibility rather than rewrite the credential engine.

## Credential interaction correction (2026-10-27)
- Select once to inspect metadata; double-click or the explicit Edit button opens the
  existing editor. Never require an unlabeled disclosure arrow to discover editing.
- Place drag handles before the type icon. Keep edit and Agent use visible; move
  Test, History and Delete into a light-dismiss, keyboard-accessible More popover.
- Detail fields use localized built-in names, explicit field-count units and
  saved/missing states. User-defined field names remain literal; secret plaintext
  never appears during metadata inspection.
- Keep primary detail actions near the identity, above secondary field information.
- Agent use opens a copyable instruction and explains that it does not execute.
  Disabled/incomplete SSH keeps a visible disabled action and a repair explanation;
  classification alone never grants SSH capability or changes Agent visibility.
- Environment-variable groups are available both as a first-class new-item
  combination and from the editor's Add module menu. They are an editor composition
  aid, not a new persisted schema: paste one KEY=VALUE per line and create ordinary
  custom-secret modules.
  Validate and reject the whole batch on malformed/duplicate/conflicting names,
  keep values masked, allow each generated KEY to be renamed, and never send the
  pasted block to an agent, log or remote service. Generated hidden fields remain
  usable through KeyHub's local `secretEnv`/placeholder injection.
- Passkeys are WebAuthn credentials created by a website in the browser, not
  manually authored desktop secrets. Explain that boundary in the new-item
  template picker and in the Passkey filter's empty state, while allowing the
  filter to match any item that carries passkeys, including ordinary logins.

## Visual language
- Color: cool off-white shell (#f5f5f7), white grouped content, quiet gray borders,
  charcoal primary commands and neutral dark mode. Color signals are reserved for state.
- Typography: local platform sans-serif with CJK fallback, 22-24px page headings,
  20px dialog titles, 14px body/controls, 13px help/labels and a 12px minimum for
  compact metadata; SFMono-Regular only for literal keys. Titlebar glyphs and
  decorative switch indicators remain compact. Do not shrink text at narrow widths.
- Rhythm: 4/8px spacing base; compact 204px sidebar, centered content max 1180px,
  32px commands, 64-74px list rows; 40px titlebar and unobtrusive bottom status strip.
- Shape: 12-14px grouped cards, 7-8px commands and fields, pill-shaped small choices,
  white softly raised sidebar selection with no blue indicator rail.
- macOS window buttons: traffic-light visual treatment on the left using the existing
  native window-action command; other platforms retain their functional window controls.
- Motion: short state feedback and existing expand/collapse; honor reduced motion.
- Icons: existing inline SVGs, no external resources or new package dependencies.
- Logo source: renderer/app-mark.svg; generate every UI, extension and native icon
  from this source with scripts/generate-keyhub-icons.mjs. Preserve transparent
  corners, small-size legibility, extension identity and all resource paths.

## Logo refresh plan (2026-10-27)
- Change only the brand mark and its derived icon assets; do not change permissions,
  credential behavior, vault formats, extension identity or MCP configuration.
- Replace the old shape-specific test with the key/K contract before implementation.
- Add size, alpha-channel, shared-pixel and native-container regression checks.
- Save the image-generation concept as a reference, then author the production SVG.
- Generate all assets deterministically with the existing Tauri CLI; no new dependencies.
- Inspect 16/20/32/64/128px previews in light/dark surroundings and record a verdict
  under .omx/state/logo-refresh/ralph-progress.json before any further visual edit.
- Run logo drift checks, brand tests, workspace regressions and the macOS build.
- Update the installed app recoverably, without modifying the user's vault or Agent settings.

## Components
- Menu bar: separate 400x520 compact panel with credential search, Agent and recent
  activity tabs, bridge/lock status, full-window/settings/lock/quit actions. A macOS
  setting hides the Dock icon and starts with main hidden only when tray creation
  succeeds. Panel dismisses on blur, Escape and repeated icon click.
- Quick panel receives only explicitly allowlisted metadata and commands. Locked
  snapshots omit credential/activity lists; viewing or editing plaintext stays in main.
- Reuse all existing editor, PIN, import/export, generator, backup and confirmation controls.
- Changed: softly raised sidebar selection, compact breadcrumb/command bar, status strip,
  grouped settings rows, credential list and metadata inspector.
- New: folder/favorite scope, selection state, empty detail state, Agent setup shortcut.
- Tokens: renderer/workspace.css owns workspace palette, type scale and final control
  overrides, including secondary dialogs and owner access; legacy files retain behavior
  geometry. renderer/quick.css mirrors the neutral palette for the separate quick window.

## Readability pass (2026-10-27)
- User correction: every desktop page must match the homepage, and editor text is too
  small. Cover all three pages, six settings groups, seven dialog roots, inline editing,
  owner lock and all three quick-panel tabs in Chinese/English and light/dark.
- Keep neutral grouped panels, flat graphite commands and rounded fields/switches;
  remove hardware inset shadows and native gradient selects from secondary surfaces.
- Small browser windows stack editor fields/templates and website rules; dialog body
  scrolls independently while header/footer remain reachable. Intermediate native
  windows bound the metadata inspector to a scrollable panel to avoid header overlap.
- Regression entry: scripts/test-readable-ui.mjs; immutable synthetic renderer only,
  no real credentials, native-vault writes or external connections.

## Accessibility
- Target: WCAG AA readable contrast, visible focus and minimum 36px primary targets.
- Keep dialog focus traps, keyboard module/item reordering and Escape/draft behavior.
- Cmd/Ctrl+K and Cmd/Ctrl+F focus search when no sensitive dialog is open.
- Use real headings, button labels, pressed/current states and text status equivalents.
- Reduced motion disables decorative entrance animation.

## Browser companion parity (2026-10-27)
- The extension popup, vault editor/history/trash, capture review and Passkey request
  use the same cool neutral canvas, rounded white groups and charcoal actions.
- Explicit Chinese/English and system/light/dark selectors persist only UI preferences.
  Default language follows the browser; desktop labels follow its selected language.
- Translate application-owned states/actions; keep provider names, literal APIs,
  stored enum values, unknown diagnostic errors and user-authored data unchanged.
- Preserve extension identity/key, permissions, pairing, secret lifecycle and protocols.
- Existing unpacked installations need a reload after the app resources are updated;
  uninstalling or clearing extension data is not part of a UI update.
- Regression entries: scripts/test-desktop-localization.mjs and
  scripts/test-extension-ui.mjs, plus real synthetic bridge/fill/capture/Passkey suites.

## Responsive behavior
- Default native window: 1200x800, resizable; minimum 760x600.
- Wide: 204px sidebar, centered flexible list and 280px metadata panel.
- Empty vault: one contained add-credential card; no empty secondary inspector or
  floor-to-ceiling white boxes. Filtered-empty state offers filter reset instead.
- Medium: narrow sidebar, metadata detail below list; readable settings and editor.
- Narrow browser fixture: compact horizontal navigation; stacked content and dialog scrolling.
- Every filter remains reachable via horizontal scrolling; never hide actions only on hover.

## Interaction states
- Loading: retain existing state-loading path; no fabricated vault or agent entries.
- Empty: useful add action for empty vault and clear action for filtered results.
- Error: preserve native error messages and existing toast/confirmation behavior.
- Success: real command results only; no invented connection or policy guarantees.
- Disabled/locked: preserved owner checks; metadata inspector clears while locked.
- Offline: service labels distinguish readiness, pairing, connected and error states.

## Content voice
- Plain, concise, bilingual. Use credentials/vault/agent rather than opaque letter codes.
- Explain that metadata inspection does not retrieve secret plaintext.
- Label capability availability, not invented authorization grants.
- Integration detection failures show a concrete reason, recovery hint and expandable
  diagnostic/config/CLI paths; never replace backend errors with only "Detection failed".
  Known causes are localized; unknown diagnostics remain escaped, bounded plain text
  with common authorization/token forms redacted. No configuration content is fetched.

## Implementation constraints
- Vanilla JS/HTML/CSS and Tauri 2; no dependencies, remote assets or real-vault test data.
- Keep existing public/native command contracts and element IDs.
- Regression tests use synthetic Tauri commands and isolated headless Chrome.
- Screenshot QA: 1200x800, 1440x960, 760x900, 390x844; light/dark and Chinese/English.
- Preserve existing behavior tests; replace obsolete hardware-pixel expectations only explicitly.

## Cleanup plan and verification
- Establish existing personal-vault and GitHub setup regressions before edits.
- Add a failing workspace interaction test before implementing its new contract.
- Limit production changes to renderer presentation and native window geometry.
- Do not change encryption, external connections, installed agent configuration or real vaults.
- Rename compatibility: canonical CLI/MCP id is `keyhub`, visible product is `KeyHub`;
  `openkeylet` and `kru` binaries/templates/environment overrides remain supported.
  Preserve `dev.kru.desktop`, `mcp-vault/v2`, extension fixed identity/storage/protocols,
  encryption AAD, `.mvault` formats and `openkeylet.vault.json` cloud snapshot path.
- Run syntax/version checks, workspace/window tests and existing functional renderer suites.
- Review screenshots before subsequent visual edits; record measured verdicts under
  .omx/state/workspace-ui/ralph-progress.json without activating an OMX runtime workflow.

## Open questions
- The user explicitly corrected the first Web-dashboard direction and requested native
  client styling resembling their local Magpie. Follow the supplied screenshots and
  inspected local app, not the earlier green theme or unrelated WinUI application.
- This retains Tauri and the existing frontend; it is a visual adaptation, not native
  Cocoa controls, and does not copy Magpie code, icons or private settings.
- Rust verification uses an explicitly selected parallel 1.88.0 toolchain; the host's
  default 1.86 toolchain is unchanged. Native OS window behavior is not visually tested.
