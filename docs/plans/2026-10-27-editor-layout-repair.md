# Editor layout regression repair

- User screenshot is the floating Add Item dialog with website matching expanded.
- Root cause to prove: legacy .small-button width43px survives the readable UI's
  font/padding override, leaving only17px for the Add Website label. Existing
  audits covered closed website details and ancestor bounds, not label line boxes.
- Also verify generated-password action spacing: gap on a block module-control
  does not create separation. Keep readability and accepted global workspace.
- Add regression for expanded website matching in floating and inline editors,
  Chinese/English, both themes, native minimum and narrow sizes. Check text range
  line count, local button overflow, rows after adding/removing websites, hit
  targets and footer availability; use synthetic Tauri only.
- Make only evidence-backed CSS changes. No backend, vault, dependency, installed
  app or unrelated user-file changes.
- Review screenshots before each visual edit; store verdict in
  .omx/state/editor-layout-repair/ralph-progress.json.
- Run targeted editor layout checks, existing inline behavior, personal-vault,
  workspace and readable UI regressions. Native WebView remains a separate gap
  unless a WebKit test runtime is available.

## Result
- Reproduced the supplied screenshot at1200x800: Add Website measured43px
  against94.6px needed, multi-line text escaped the button; Generate gap was0px.
- Fixed only renderer/workspace.css: text buttons in website matching size to
  content; module controls use a real grid gap; Generate remains content-sized.
-72/72 expanded-editor checks passed;360/360 readable checks;38/38 workspace
  checks; existing inline editor and personal-vault behavior suites passed.
- Inspected floating Chinese light and narrow inline English dark screenshots.
- No native vault or installed application changes.
