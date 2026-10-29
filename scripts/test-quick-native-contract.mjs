import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('compact webview has only event subscription plugin permissions', () => {
  const quick = JSON.parse(read('src-tauri/capabilities/quick-panel.json'));
  assert.deepEqual(quick.windows, ['quick']);
  assert.deepEqual(quick.permissions.sort(), ['core:event:allow-listen', 'core:event:allow-unlisten']);
  const others = fs.readdirSync(new URL('../src-tauri/capabilities', import.meta.url)).filter(file => file.endsWith('.json') && file !== 'quick-panel.json');
  for (const file of others) assert.ok(!JSON.parse(read(`src-tauri/capabilities/${file}`)).windows.includes('quick'));
});

test('only PIN verification and PIN setup can unlock the owner session', () => {
  const source = read('src-tauri/src/commands.rs');
  assert.equal((source.match(/keep_owner_unlocked\(&runtime\)/g) || []).length, 2);
  for (const command of ['owner_secret_view', 'owner_editor_drafts', 'copy_owner_value']) {
    const body = source.match(new RegExp(`async fn ${command}\\([\\s\\S]*?(?=\\n#\\[tauri::command\\])`))?.[0];
    assert.ok(body, command);
    assert.match(body, /owner_read_guard\(&runtime\)\.await\?/);
    assert.doesNotMatch(body, /keep_owner_unlocked/);
  }
});

test('main and compact native windows have independent lifecycles', () => {
  const source = read('src-tauri/src/commands.rs');
  const quickScript = read('renderer/quick.js');
  const config = JSON.parse(read('src-tauri/tauri.conf.json'));
  assert.match(source, /window\.label\(\) == "quick"/);
  assert.match(source, /Focused\(false\)/);
  assert.match(source, /ActivationPolicy::Accessory/);
  assert.match(source, /WebviewUrl::App\("quick\.html"/);
  assert.equal(config.app.macOSPrivateApi, true);
  assert.match(source, /WebviewWindowBuilder::new[\s\S]*?\.transparent\(true\)/);
  assert.doesNotMatch(source, /WebviewWindowBuilder::new[\s\S]*?\.transparent\(false\)/);
  assert.match(quickScript, /document\.addEventListener\('blur', \(\) => \{ void command\('quick_action', \{ action: 'hide' \}\); \}\);/);
  assert.match(source, /macos_monitor_index/);
  assert.match(source, /quick\.set_position\(tauri::LogicalPosition/);
});

test('Linux drag setup failures return through the oneshot sender', () => {
  const source = read('src-tauri/src/commands.rs');
  const drag = source.slice(source.indexOf('async fn drag_browser_extension('), source.indexOf('fn browser_extension_path('));
  assert.match(drag, /let result = \(\|\| -> Result<\(\), String> \{/);
  assert.match(drag, /gtk_window\(\)\.map_err\(command_error\)\?/);
  assert.match(drag, /\}\)\(\);\s*let _ = sender\.send\(result\)/);
});
