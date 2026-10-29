# Modal Backdrop Gesture Fix

**Goal:** Releasing a pointer over a modal backdrop must not dismiss a dialog
when the gesture started in a field or other dialog content.

**Root cause:** The editor, confirmation and GitHub dialogs dismiss on `click`
when its target is the backdrop. Browsers retarget a click whose press and
release are on different descendants to their common ancestor, the backdrop.

**Implementation:** Use a shared pointer-gesture guard for the three existing
backdrop-dismissible dialogs. Only a primary left-button click with matching
press/release on that same backdrop and no drag/cancellation dismisses it.
Keep explicit Close/Cancel, Escape, draft-save and GitHub busy checks intact.
Do not add outside dismissal to generator, backup-password, migration or
history/trash dialogs that currently require their explicit close actions.

**Verification:** Write failing synthetic browser regressions for real pointer
down inside / move outside / up. Cover reversed paths, fields, controls,
text selection, cancellation, right click, busy GitHub state, nested dialogs
and normal backdrop clicks. Verify the same behavior in installed native
WebKit, rebuild/install recoverably without mutating user credentials, and
run existing editing/backup/workspace/window tests.

## Verified Result

- The shared gesture guard replaces all three click-only backdrop handlers.
  Pointer down and up must belong to the same backdrop and primary pointer;
  movement, cancellation and window blur invalidate the gesture. Dismissal
  occurs on click, not pointerup, preventing click-through to underlying controls.
- Synthetic pointer regression suite: 18 scenarios pass, including busy GitHub,
  nested confirmations, touch capture loss and preserving unsaved editor values.
- Existing controls/editor, personal vault, GitHub, 38 workspace, 616 desktop,
  360 readability, 58 titlebar and 9 owner-lock race checks pass.
- Independent scoped review found no concrete bugs.
- Installed macOS Release app updated at `/Applications/KeyHub.app`; the prior
  app is retained by the installer. Signature and ZIP checksum verify, and
  vault/master-key hashes were unchanged across installation.
- Native WebKit manual-input verification: inside-down/outside-up and the reverse
  keep the blank editor open; a complete outside click dismisses it. No test
  credential was created or existing credential opened during this check.
