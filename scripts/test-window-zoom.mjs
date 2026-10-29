import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('macOS maximize routes through current-window monitor zoom instead of native borderless maximize', () => {
  const source = read('src-tauri/src/commands.rs');
  assert.match(source, /"maximize"\s*=>\s*\{?\s*toggle_workspace_zoom\(&window\)\.await/);
  assert.match(source, /window_zoom::/);
  assert.match(source, /\.current_monitor\(\)/);
  assert.match(source, /LogicalPosition::new/);
});

test('titlebar double click uses a single owned handler and preserves native dragging', () => {
  const html = read('renderer/index.html');
  const app = read('renderer/app.js');
  assert.match(html, /<script src="titlebar\.js"><\/script>/);
  assert.match(app, /KeyHubTitlebar\.install/);
  assert.match(html, /data-tauri-drag-region="deep"/);
  assert.doesNotMatch(app, /titleDragRegion\.addEventListener\('mousedown'/);
});
