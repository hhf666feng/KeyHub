# Workspace control geometry and regression contract

The workspace presentation in `renderer/workspace.css` supersedes the compact
Bricktone console layout. Regression tests should protect usable controls and
credential behavior, not the previous 460 px console's fixed row heights,
universal recessed materials, icon centerlines, glow-only hover, or equal cap
clearances. The historical `fixtures/control-geometry.mjs` and
`fixtures/control-states.mjs` retain those presentation assumptions and are not
used by the workspace inline-editor suite.

The current visual reference is the local yetone Agent manager
`/Applications/magpie.app` (`com.yetone.magpie`), not the unrelated Blinue Windows
upscaler. Use softly rounded neutral groups, white selected navigation, and
compact content-height empty states. macOS traffic-light disks are visual
pseudo-elements inside larger keyboard-accessible native-action targets.

## Responsive layout

`scripts/test-inline-editor.mjs` checks the workspace at widths of 390, 460, 760,
and 1200 CSS pixels, in English and Chinese, in both themes. The shell matrix
also covers device scale factors of 1, 1.25, 1.5, and 2. These scales change pixel
density, not CSS viewport width; they are not a substitute for the width matrix.

- The document must not overflow horizontally. Visible workspace regions must
  stay within horizontal viewport bounds and must not silently clip content.
- Title controls, navigation, search, add, filtering, editing, and item reorder
  controls must remain visible and reachable by scrolling. Custom window
  controls stay available at narrow widths because the native shell is frameless.
- Expanded editors are checked at all four widths in both themes. Their header,
  close button, name field, add-module control, and save button stay reachable.
- Inline editors remain nonmodal regions, keep their visible header, do not
  trap Tab, and preserve expansion/collapse and reduced-motion behavior.
- Row actions must receive pointer input even when an editor is expanded.
  Keyboard confirmation tests do not excuse overlapping pointer targets.

## Interaction and security

- Navigation and type/activity/settings filters are ordinary labeled buttons.
  Test clicks, selected state, keyboard selection, filtering, and per-page
  search retention rather than travelling caps or drag-to-slide behavior.
- Search is visible in the workspace toolbar. Escape clears its query; the
  search shortcut focuses it. A search-button click must not discard a query.
- Clicking `.connection-name` selects metadata preview without opening the
  editor or retrieving plaintext. Name buttons are not sorting handles.
- Pointer and keyboard sorting use `.workspace-reorder[data-item-reorder]`.
  Preserve drag feedback, Home/End and arrow-key ordering, focus restoration,
  hidden filtered slots, edge scrolling, Escape/outside-drop cancellation,
  failed-write recovery, and stale-order protection. Verify native payloads,
  including `expectedOrder`, not just the rendered sequence.
- Theme, language, and binary switches retain their drag interactions. Test
  cancellation, same-position release, single commits, saved preferences,
  and failure recovery. The sound preference remains a visible titlebar control;
  its value and reload persistence are also checked through the appearance API.
- Binary switches retain ON/OFF text and redundant check/minus glyphs. Module
  permissions retain localized visible/hidden captions and accessible names
  synchronized with `agentVisible`. Enabled text must meet 4.5:1 contrast;
  disabled controls must not change permission state on pointer input.
- Owner secret edits, visibility permissions, and item enablement remain
  independent. Saving must preserve permission and favorite metadata.
- Draft persistence and failed-write recovery protect unsaved edits across
  filtering, refresh, language changes, row switching, and navigation. Stale
  saves must not overwrite a newer revision or discard the active form.
- PIN removal and item deletion require explicit confirmation. Cancellation
  must not write, confirmation retains its focus trap, and inline-editor focus
  remains untrapped outside nested dialogs.

## Running and evidence

With Playwright and its browser available, run `npm run test:controls`. To use
installed Chrome rather than download an additional browser, run:

```sh
PLAYWRIGHT_CHANNEL=chrome npm run test:controls
PLAYWRIGHT_CHANNEL=chrome npm run test:workspace
PLAYWRIGHT_CHANNEL=chrome npm run test:desktop
npm run test:window
```

No dependency installation or production vault is needed. A synthetic Windows
platform exposes both system-integration switches even on a macOS test host;
all native commands use isolated fixtures. Each run copies the renderer into
its artifact directory so subsequent production edits cannot change the tested
version mid-run. CSP stays enabled; bounded polling does not require unsafe
eval.

The printed temporary artifact directory contains the renderer snapshot,
responsive screenshots, `control-geometry.json`, `control-states.json`,
`visual-failures.json`, and `result.json`. A failed run also records
`failure.png`. Accessibility and action-hit-testing failures are accumulated
without skipping later functional checks, then fail the process at the end.
`functionalChecksPassed: true` therefore does not imply that the suite passed;
`ok` must also be true and the process must exit successfully.
