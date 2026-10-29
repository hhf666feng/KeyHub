# KeyHub mark

The key bow and stem combine with two rounded branches to form a K. The central
hub represents locally mediated credential use; the amber branch is the single
accent. There is no shield, padlock, text or small network decoration in the mark.

- Production source: `../../renderer/app-mark.svg`
- Palette: graphite `#25282D`, warm ivory `#F9F6EE`, amber `#F1A24A`
- Small-size/light-dark review: `keyhub-logo-preview.png`
- Generated exploration: `keyhub-logo-concept.png`
- Rebuild: `npm run icons:generate`
- Verify size, alpha, containers and asset drift: `npm run test:logo`

The concept was generated with the built-in image generation tool, then rebuilt
as an editable SVG. Production PNG, ICNS and ICO files are rendered from the SVG
by the already-installed Tauri CLI, not cropped from the generated concept image.
ICNS chunks are sorted for deterministic regeneration; image payloads are unchanged.
The preview wordmark is presentation-only, not an application font dependency.

## Concept prompt

Design one premium, restrained macOS application icon for KeyHub, a local
credential broker for AI agents. Center a graphite rounded square on a neutral
background. Use one very simple geometric glyph merging a key and capital K:
an open circular key bow, thick vertical stem and two rounded diagonal branches.
Make the spine and upper branch warm ivory, the lower branch amber, and the
central hub dark. Keep generous negative space and a silhouette readable at
16px. Restrict the palette to graphite #25282D, ivory #F9F6EE and amber #F1A24A.
No wordmark, shields, padlocks, network-node diagrams, thin lines, chrome, glow,
blue, purple, ornamental details or watermark. This is a vector-friendly design
reference, not a photograph.

## Scope

Only visual resources and their generation tests change. Keep the bundle ID,
extension public key/ID, permissions, vault formats, encryption identifiers,
MCP commands and all existing asset paths unchanged.
