# Menu Bar Panel Implementation Plan

**Goal:** Add a compact Magpie-inspired tray panel and an opt-in macOS menu-bar-only mode without losing the full workspace or credential capabilities.

**Architecture:** Keep the existing main webview and vault unchanged. A separate hidden `quick` webview displays a deliberately narrow metadata-only snapshot from Rust and delegates editing, unlocking and configuration to the main window. Existing tray right-click actions remain available; left click toggles the compact panel. Persist `menuBarOnly` with a backward-compatible default of false; only hide the Dock icon after tray creation succeeds.

**Tech Stack:** Existing Tauri 2, Rust, vanilla HTML/CSS/JS, Playwright. No new dependencies or native private APIs.

## Contracts
- `quick_state` -> `{language, menuBarOnly, owner:{pinConfigured,unlocked}, credentials:[{id,name,itemType,favorite,enabled,capabilities}], activities:[{id,time,status,connectionName,action}], agents:[{clientId,displayName,detected,state}], browser:{enabled,connected,status}, credentialCount, enabledCount}`.
- Locked snapshots return empty credentials and activities. Never include secrets, public module values, paths, tokens, activity errors, or editor drafts.
- `quick_open_main` takes `{page:'connections'|'activity'|'settings', itemId?:string, section?:'APP'|'MCP'|'WEB'}`. It hides the panel and emits `workspace-navigation` after showing main. Invalid routes/items fail safely.
- `quick_action` takes `{action:'hide'|'lock'|'quit'}`. Lock propagates to both webviews; if PIN is missing, open existing PIN setup. Quit uses existing runtime invalidation.
- `menuBarOnly` hides the Dock while main can still be explicitly opened. Startup hides main only when the preference is true AND the tray is available; explicit Finder reopen always opens main.
- Panel is about 400x520 logical pixels, bounded to the selected monitor work area, anchored below macOS status item. Escape/repeated icon click/blur hide it. Native context-menu fallback retains Open/Lock/Quit.

## Execution
1. Write and run failing tests for settings compatibility, geometry and metadata filtering.
2. Implement Rust snapshot/placement helpers and integrate tray, startup, docking and close lifecycle.
3. In parallel, implement isolated `renderer/quick.html`, `quick.css`, `quick.js` and synthetic browser tests using these command contracts.
4. Add the main settings toggle and safe metadata-only navigation to the existing workspace, preserving drafts.
5. Verify targeted tests, existing workspace/window/brand suites, full/headless Rust, and Release build.
6. Inspect compact panel light/dark, empty/locked and narrow viewports; record visual verdict.
7. Back up the installed app and update locally; verify real status-item click, blur/Escape, main reopen, Dock hide and persistence. Do not rewrite Agent registrations or credentials.

## Safety And Completion
- Preserve `dev.kru.desktop`, `openkeylet-tray`, legacy aliases, extension identity and vault/backup formats.
- No testing in the real credential vault until safe installation and the requested display preference update; synthetic data for automated tests.
- No claim of native completion based on Chromium screenshots alone.
- No commit, push, cloud configuration change or developer signing requested.
