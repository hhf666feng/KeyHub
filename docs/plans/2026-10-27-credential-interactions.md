# Credential Workspace Interaction Repair

## Acceptance
- Single click selects metadata only; explicit Edit and double-click open the existing
  editor. Preserve drafts, owner checks, revision guards and keyboard reorder.
- Reorder handle is at the leading edge; rare Test/History/Delete actions live in a
  keyboard-accessible More popover, with the existing destructive confirmation.
- Built-in field labels are localized even when legacy metadata repeats an internal
  name. Preserve user-defined names and do not display secret plaintext in details.
- Counts say "N fields"; no unexplained raw counts or boolean values. Public fields
  show safe formatted metadata; secret fields show saved/missing and Agent visibility.
- Agent Use is consistent for configured SSH/API/login items. It opens an explanation
  and copyable MCP instruction, never silently connects to a host or reveals a secret.
  Incomplete or disabled items show a disabled action and a specific repair explanation.

## Execution And Safety
1. Add failing synthetic renderer tests for the reported behavior and privacy boundary.
2. Repair presentation/action routing only; read-only parallel audit of SSH capability
   generation. Do not change capability authorization or contact real hosts.
3. Review screenshots at native desktop and narrow widths in both languages/themes;
   record visual verdict before subsequent edits.
4. Run workspace/editor/lock/modal/readability regressions, build/package, recoverably
   update the local app while preserving the vault, pairing and active MCP processes.
5. Inspect installed native metadata/editor entry when unlocked. Report any lock gate.

## Verification Outcome
- New interaction cases: 18 pass across Chinese/English and 1440/760/390px.
- Workspace: 40 pass; desktop: 616 pass; readability: 360 pass; owner races:
  9 pass; backdrop gestures: 18 pass; localization: 6 groups pass.
- Existing inline-editor, personal-vault, quick-panel and brand/packaging suites pass.
- Release macOS ARM64 build, portable archive/per-file checksums and ad-hoc signing
  verified. Installed final binary matches packaged binary; previous app recoverable
  in KeyHub Installer Backups. Vault/master-key/epoch unchanged during replacement;
  All pre-existing MCP sessions preserved (17 at the final reviewed installation).
- Native post-update UI remains unverified because the Mac is locked. No real SSH
  test, credential edit, remote command or extension pairing reset was performed.

- Independent review identified and repaired repeated popover-trigger dismissal,
  refresh/selection signature suppression and animated editor focus escape. Expanded
  synthetic cases pass with actual motion enabled and inert-background assertions;
  workspace navigation and metadata-only reselection pass again after the repair.
