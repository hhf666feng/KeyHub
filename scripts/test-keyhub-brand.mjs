// Product naming must not alter the encrypted-data or extension identities.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
const text = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const json = file => JSON.parse(text(file));

test('KeyHub is the visible desktop and package brand', () => {
  const config = json('src-tauri/tauri.conf.json');
  assert.equal(config.productName, 'KeyHub');
  assert.equal(config.app.windows[0].title, 'KeyHub');
  assert.equal(json('package.json').name, 'keyhub');
  assert.match(text('renderer/index.html'), /<title>KeyHub<\/title>/);
  assert.match(text('renderer/index.html'), /<strong>KeyHub<\/strong>/);
});

test('repository landing pages use the current KeyHub logo rather than legacy artwork', () => {
  for (const file of ['README.md', 'README.zh-CN.md']) {
    assert.match(text(file), /src="\.github\/assets\/keyhub-hero\.svg"/);
    assert.doesNotMatch(text(file), /openkeylet-hero|keyHub/);
  }
  const hero = text('.github/assets/keyhub-hero.svg');
  const logo = text('renderer/app-mark.svg');
  for (const match of logo.matchAll(/<path[^>]+d="([^"]+)"/g)) {
    assert.ok(hero.includes(`d="${match[1]}"`), 'hero must reuse current logo geometry');
  }
  assert.match(hero, />KeyHub</);
  assert.doesNotMatch(hero, /keyHub|OpenKeylet|ed4a1a/);
  assert.ok(!fs.existsSync(new URL('../.github/assets/openkeylet-hero.svg', import.meta.url)));
});

test('public support and download links point to the owned KeyHub repository', () => {
  for (const file of ['PRIVACY.md', 'PRIVACY.zh-CN.md', 'browser-extension/privacy.html',
    'scripts/sync-extension-privacy.mjs', 'docs/chrome-web-store/listing.en.md',
    'docs/chrome-web-store/listing.zh-CN.md', 'docs/chrome-web-store/reviewer-instructions.md']) {
    assert.ok(text(file).includes('https://github.com/hhf666feng/KeyHub'), file);
    assert.doesNotMatch(text(file), /https:\/\/github\.com\/omaekumiko2-create\/OpenKeylet/, file);
  }
});

test('canonical and legacy command binaries remain available from one implementation', () => {
  const cargo = text('src-tauri/Cargo.toml');
  assert.match(cargo, /\[package\][\s\S]*?name = "keyhub"/);
  const bins = [...cargo.matchAll(/\[\[bin\]\]([\s\S]*?)(?=\n\[|$)/g)].map(match => match[1]);
  for (const name of ['keyhub', 'openkeylet', 'kru']) assert.ok(bins.some(bin => bin.includes(`name = "${name}"`)), `${name} binary missing`);
  assert.match(cargo, /\[lib\]\s+name = "mcp_vault"/);
  for (const file of ['src-tauri/src/main.rs', 'src-tauri/src/bin/openkeylet.rs', 'src-tauri/src/bin/kru.rs']) assert.ok(text(file).includes('mcp_vault::cli::run()'), file);
});

test('existing encrypted vault and cloud snapshots retain their compatibility identifiers', () => {
  assert.equal(json('src-tauri/tauri.conf.json').identifier, 'dev.kru.desktop');
  assert.match(text('src-tauri/src/storage.rs'), /join\("mcp-vault"\)\.join\("v2"\)/);
  assert.match(text('src-tauri/src/crypto.rs'), /b"mcp-vault\/secret\/v2"/);
  assert.match(text('src-tauri/src/backup.rs'), /b"openkeylet\/password-backup\/v1"/);
  assert.match(text('src-tauri/src/backup.rs'), /format: "openkeylet-password-backup"/);
  const cloud = text('src-tauri/src/github_backup.rs');
  for (const value of ['openkeylet.vault.json', 'openkeylet-cloud-backup', 'openkeylet-github-device', 'openkeylet/cloud-backup/v1']) assert.ok(cloud.includes(value), value);
});

test('all original native commands and core capabilities remain registered', () => {
  const commands = text('src-tauri/src/commands.rs').match(/tauri::generate_handler!\[([\s\S]*?)\]/)[1].split(',').map(value => value.trim()).filter(Boolean);
  const expected = ['get_state', 'owner_status', 'owner_set_pin', 'owner_disable_pin', 'owner_unlock', 'owner_lock', 'owner_secret_view', 'owner_editor_drafts', 'save_editor_draft', 'delete_editor_draft', 'copy_owner_value', 'save_connection', 'reorder_connections', 'set_connection_enabled', 'delete_connection', 'owner_trash', 'owner_restore_item', 'owner_purge_item', 'owner_password_history', 'owner_clear_password_history', 'test_connection', 'update_settings', 'system_integration_status', 'set_desktop_shortcut', 'set_launch_at_login', 'clear_activities', 'copy_mcp_config', 'agent_mcp_status', 'agent_mcp_register', 'agent_mcp_repair', 'agent_mcp_remove', 'choose_private_key', 'quick_pair_browser', 'reset_browser_pairing', 'open_browser_extension_folder', 'drag_browser_extension', 'export_backup', 'generate_password', 'import_backup', 'prepare_import', 'commit_import', 'cancel_import', 'github_backup_status', 'github_backup_account', 'github_backup_generate_key', 'github_backup_recovery_key', 'github_backup_connect', 'github_backup_upload', 'github_backup_restore', 'github_backup_disconnect', 'github_backup_help', 'open_data_folder', 'window_action'];
  assert.deepEqual([...commands].sort(), [...expected, 'quick_state', 'quick_open_main', 'quick_action'].sort());
  for (const method of ['credential_fill', 'http_send', 'items_search', 'ssh_download', 'ssh_run', 'ssh_upload', 'terminal_read', 'terminal_run', 'terminal_start', 'terminal_stop', 'terminal_write']) assert.ok(text('src-tauri/src/mcp.rs').includes(`name = "${method}"`), method);
  for (const control of ['connection-name', 'connection-type', 'connection-folder', 'browser-enabled', 'pin-enabled', 'github-backup-card', 'migration-open', 'generator-open', 'trash-open']) assert.ok(text('renderer/index.html').includes(`id="${control}"`), control);
});

test('new environment and template names coexist with both historical names', () => {
  const storage = text('src-tauri/src/storage.rs');
  for (const value of ['KEYHUB_DATA_DIR', 'OPENKEYLET_DATA_DIR', 'KRU_DATA_DIR']) assert.ok(storage.includes(value), value);
  const mcp = text('src-tauri/src/mcp.rs');
  for (const value of ['{{keyhub:', '{{openkeylet:', '{{kru:', 'KEYHUB_LAUNCHER_PATH', 'OPENKEYLET_LAUNCHER_PATH', 'KRU_LAUNCHER_PATH']) assert.ok(mcp.includes(value), value);
});

test('extension rebrand retains its public key and message protocols', () => {
  const manifest = json('browser-extension/manifest.json');
  assert.ok(manifest.name.startsWith('KeyHub'));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.key, 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAzesfPsufH+3chxkp9tpIJ/ysZpQaHcDF8Zba1+UMcbfH3qS27RXlG9VQKkPRh3PhvXE6RYYefyzcEj82Uveqol8cjkmYBe/7Q7r2fB9Aridw3ARVdMxoXjdmM0aN0aW/1LCN11H5ML6yl6ELy8rF8i2LABcdRrBgg/5ynnriLhv7BWsftUrer8Gbbv+jITCTmBeWtQyBzgbrEU2eoGy34NwvRfj53z8bjr1W0NhABj7pS7Z2UdDpKoYxU/hKuC9ooLKrglC3kXfTb281lsPWu9ggMNnSH5gdy/1quQtCaaEUPRZCMTcDVIYKpb/HeEWa+fyVauAAx82klJ4d7BemywIDAQAB');
  assert.deepEqual(manifest.permissions, ['scripting', 'storage']);
  assert.deepEqual(manifest.host_permissions, ['http://*/*', 'https://*/*']);
  assert.ok(text('browser-extension/service-worker.js').includes('openkeylet-focus'));
  assert.ok(text('browser-extension/provider.js').includes('openkeylet-webauthn'));
});
