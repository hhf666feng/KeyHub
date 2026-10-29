# Repository Cleanup Plan

## Goal And Boundaries

Prepare the existing KeyHub worktree for a reviewable GitHub push without
changing credential execution, encrypted formats, UI behavior, or release tags.
Preserve the pre-existing rebrand and feature changes. Do not access a real vault.

## Ordered Passes

1. Run existing brand, native-contract and owner-lock regression tests first.
2. Consolidate duplicated loopback static servers in bounded renderer tests.
   Add behavior tests for root routing, content types, missing files and traversal
   rejection before extracting the shared helper. Preserve test assertions.
3. Add dependency-free unit/UI suite entry points and JavaScript syntax checks.
   Keep browser/backend integration and public-site probes explicit, not implicit.
   Execute UI suites sequentially to bound memory pressure.
4. Ignore local `.omx/` state, keeping authored plans and tests versioned.
5. Rewrite bilingual READMEs as product/developer entry points; retain detailed
   browser, backup, migration and MCP behavior in linked bilingual guides.
6. Run regression suites, syntax/version checks, Rust formatting, tests, check
   and Clippy with an installed supported toolchain. Review staged content for
   secrets, local paths and accidental build/runtime output before committing.
7. Commit with Lore decision context, push to the existing GitHub remote, and
   verify the remote commit. Do not create a release or replace the installed app.

## Fallback Inventory

- Legacy command, environment, template and encrypted-format identifiers are
  grounded compatibility contracts. Retain them and their existing tests.
- Tray failure keeps the main window available; preserve the native fail-safe.
- Static test-server 404 handling is an intentional fixture boundary; test it.
- No new authentication fallback, dependency, or production abstraction is in
  scope. Broader backend/UI decomposition is deferred to avoid changing behavior.

## Review And Verification

The cleanup author and read-only reviewer are separate agents. The leader owns
integration, complete verification and publication. Synthetic browser evidence
does not claim native macOS, Windows/Linux execution, signing or release QA.

## Review Outcomes

- Reviewer confirmed the bounded test-infrastructure scope and recommended
  retaining owner-read lock guards and file-transfer rollback code unchanged.
- Final review caught a Chromium/Chrome prerequisite mismatch. UI suites now
  default to Playwright Chromium with optional `PLAYWRIGHT_CHANNEL` overrides.
- New guides are bundled in portable archives with their policy/image links;
  packaging fixtures verify contents, exclusions and checksum coverage.
- Clippy's conditional simplifications retain evaluation order. The fallible
  Linux drag closure is deliberately preserved so errors reach its sender;
  removing that boundary breaks the Linux callback's unit return type.
- Existing encrypted identifiers and compatibility aliases remain unchanged.

## Verification Results

- Rust 1.88 format/check and Clippy (`--all-targets -- -D warnings`) pass;
  the newer installed 1.97 toolchain also passes Clippy.
- GUI-feature Rust suite: 193 pass; headless: 134 pass. One high-load parallel
  terminal test failed once, then passed alone and in the complete suite with
  `--test-threads=2`. No production timing change was made based on that result.
- Node unit/contracts: 75 pass. JavaScript syntax/version checks pass.
- All 18 synthetic UI suite files pass; this includes 616 desktop cases, 372
  readability audits, and 72 editor-layout checks, not native window automation.
- Real unpacked-extension integration, 16 login-flow cases, login-capture
  privacy/history boundaries, and all three binary MCP/config aliases pass
  against isolated temporary vaults. No personal vault or real credentials used.
- Portable archive fixtures verify guides, policies, image paths and checksums;
  native Windows/Linux packaging and macOS signing/notarization remain untested.
- Existing upstream has no push permission for the authenticated user. Publish
  to the user's `hhf666feng/OpenKeylet` fork via the additional `github` remote,
  leaving the upstream `origin` intact. No release or upstream PR is requested.
