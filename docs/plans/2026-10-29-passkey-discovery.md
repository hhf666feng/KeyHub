# Passkey Discovery And Filter Consistency

## Problem
The desktop exposes a Passkey filter but intentionally omits Passkey from manual
item creation. The empty state only said no credentials matched, so the distinction
between a manual secret and a website-generated WebAuthn credential was invisible.
The filter also tested the single displayed item kind, which could hide a login or
API item that carried a passkey.

## Contract
- Keep Passkey out of manual creation and the normal item-type select. It requires
  a browser-originated WebAuthn ceremony bound to an HTTPS relying-party domain.
- Explain in the new-item template picker that passkeys are created through the
  KeyHub browser extension during website registration/sign-in or imported from
  Bitwarden.
- Give the Passkey filter a dedicated empty state. With no passkeys, route users to
  Browser Bridge setup; if passkeys exist outside the current scope, offer Clear
  filters instead.
- Match the Passkey filter against any item with `passkeys`, including login/API
  items whose primary display type is something else.
- Do not initiate a passkey ceremony, read private key material, or alter pairing.

## Verification
1. Synthetic Chinese/English tests for the template note, empty-state routing and
   passkey-bearing login filtering.
2. Existing workspace, editor, filter, localization and browser-passkey regressions.
3. Build/install recoverably and inspect the real native Passkey empty state without
   changing vault records.

## Result
- New-item template dialog explains that Passkeys are website/browser-created or
  imported; the Passkey filter has a dedicated setup-oriented empty state.- The filter matches any item carrying passkeys, including login/API items.- Synthetic Chinese/English tests pass (4 scenarios); workspace (40), readability  (372), inline-editor and localization regressions pass.- The verified macOS package was installed recoverably and relaunched. Native UI  showed both the new-item explanation and Passkey empty state. No WebAuthn ceremony,  item write, private-key read or pair reset was performed.