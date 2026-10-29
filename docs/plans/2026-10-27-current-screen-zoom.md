# Current-Screen Window Zoom Fix

**Goal:** Double-clicking KeyHub's custom titlebar or pressing Maximize must fill
the work area of the window's current display and restore its previous frame.

**Observed reproduction:** On the installed macOS application, the window at
CG bounds `[150,111,1200,800]` on the built-in 2x display moved to
`[-1920,-591,1920,1055]` on the external 1x display after Maximize. Read-only
CoreGraphics observations are saved under `.tmp/window-zoom/`.

**Root cause:** Tauri 2.11.5 forwards maximize to Tao 0.35.3. For the borderless
window, Tao's `set_maximized_async` fallback selects `NSScreen::mainScreen`, not
the window's screen. The built-in titlebar mouse-up handler uses that same path.

**Approach:** Preserve native dragging but intercept only an unmoved left-button
double click on non-interactive titlebar content and route it to `window_action`.
On macOS, implement explicit current-monitor logical work-area zoom with saved
restore bounds. Logical positioning avoids mixed-DPI physical coordinate errors.
Windows/Linux retain native maximize. No dependency, vault or menu-bar changes.

**Tests:** First fail behavioral tests for titlebar double click vs drag/control
targets and zoom/restore geometry. Cover negative monitor origins, Retina scale,
manual move/resize while zoomed and failed native writes. Run existing window,
workspace, owner-lock and Rust suites, build, update recoverably and verify native
double click, button, restore and dragging on available displays.

## Verified Result

- Main-screen selection was removed from the macOS zoom path. The window's
  `current_monitor` supplies the target work area; all setters use logical units.
- The per-window zoom mutex serializes native frame updates, and restore state
  commits only after the target frame is observed. Manual move/resize starts a
  new normal frame instead of restoring stale geometry.
- Titlebar double clicks are captured once before Tauri's built-in handler;
  single-click native drag and all controls retain their existing handlers.
- Native installed-app validation on 2026-10-27:
  - Built-in Retina 2x: `[156,64,1200,800]` to `[0,38,1512,852]`, then exact restore.
  - DELL P2419H 1x: `[-1764,-454,1200,800]` to `[-1920,-591,1920,1055]`, then exact restore.
  - External-screen Maximize button also expands and restores on that screen.
  - The window was transferred with macOS Window > Move to Display; the CUA drag
    surface did not physically move it, so manual cross-screen drag is not claimed.
- Read-only CoreGraphics evidence and install backup details are recorded under
  `.tmp/window-zoom/`; the verification does not inspect credential plaintext.
- Regression evidence: 193 GUI Rust tests, 134 headless tests, 58 titlebar cases,
  5 geometry tests, 616 desktop checks, 360 readability checks, 38 workspace cases,
  and the existing editor/personal-vault/GitHub/quick-panel suites all pass.
