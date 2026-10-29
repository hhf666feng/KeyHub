# Saved-state and enable interaction repair

- Persisted records (state.connections) and unsaved editor drafts are distinct.
  itemDetail incorrectly labels no-capability saved records as drafts.
- The unlabeled list status dot is a button invoking set_connection_enabled
  immediately. Replace it with read-only, textual enabled/disabled state.
- Only the existing editor switch plus explicit Save changes persisted enable
  state. Do not enable or modify the user's real records automatically.
- Add failing bilingual create/save tests for no-capability SSH credentials,
  harmless subtitle/status clicks, no draft creation and explicit editor-save
  toggles. Keep owner-secret calls metadata-only until explicit editing.
- Add plain detail help explaining available actions are configuration-dependent,
  separate from saved/enabled state. No inferred permissions or backend changes.
- Run workspace, readability, desktop, inline and personal UI regressions;
  inspect bilingual light/dark screenshots before further visual edits.
