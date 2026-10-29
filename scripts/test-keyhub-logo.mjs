import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
const read = file => fs.readFileSync(file, 'utf8');

test('KeyHub logo combines a key and K in a self-contained vector', () => {
  const svg = read('renderer/app-mark.svg');
  assert.match(svg, /<title[^>]*>KeyHub<\/title>/);
  assert.match(svg, /id="keyhub-mark/);
  assert.match(svg, /viewBox="0 0 128 128"/);
  assert.match(svg, /class="logo-key/);
  assert.match(svg, /class="logo-branch/);
  assert.match(svg, /class="logo-hub/);
  for (const color of ['#25282D', '#F9F6EE', '#F1A24A']) assert.ok(svg.includes(color), color);
  assert.doesNotMatch(svg, /<image|<script|<foreignObject|<text\b|https?:\/\/(?!www\.w3\.org)/);
  assert.doesNotMatch(svg, /openkeylet-mark-engraving|logo-ring|logo-bit|logo-node|logo-link/);
});

test('desktop and extension surfaces reference the same KeyHub mark', () => {
  const renderer = read('renderer/index.html');
  assert.match(renderer, /<strong>KeyHub<\/strong>/);
  assert.match(renderer, /app-mark-logo/);
  assert.match(renderer, /src="app-mark\.svg"/);
  assert.equal(read('renderer/app-mark.svg').includes('KeyHub'), true);
  const manifest = JSON.parse(read('browser-extension/manifest.json'));
  assert.equal(manifest.name, 'KeyHub');
  assert.equal(manifest.action.default_title, 'KeyHub');
});

function pngSize(file) {
  const png = fs.readFileSync(file);
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', file);
  assert.equal(png.subarray(12, 16).toString(), 'IHDR', file);
  assert.equal(png[25], 6, `${file}: RGBA retains transparent corners`);
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
}

test('all renderer and extension PNG sizes retain their required dimensions', () => {
  for (const size of [16, 20, 24, 32, 40, 48, 64]) {
    assert.deepEqual(pngSize(`renderer/app-mark-${size}.png`), [size, size]);
  }
  for (const size of [16, 32, 42, 48, 53, 63, 84, 105, 126, 128, 168]) {
    assert.deepEqual(pngSize(`browser-extension/icons/${size}x${size}.png`), [size, size]);
  }
  for (const [file, size] of [['32x32.png', 32], ['128x128.png', 128], ['128x128@2x.png', 256]]) {
    assert.deepEqual(pngSize(`src-tauri/icons/${file}`), [size, size]);
  }
});

test('shared raster sizes are identical across desktop, UI and extension', () => {
  for (const size of [16, 32, 48]) {
    assert.deepEqual(fs.readFileSync(`renderer/app-mark-${size}.png`),
      fs.readFileSync(`browser-extension/icons/${size}x${size}.png`), `shared ${size}px mark`);
  }
  assert.deepEqual(fs.readFileSync('src-tauri/icons/32x32.png'), fs.readFileSync('renderer/app-mark-32.png'));
  assert.deepEqual(fs.readFileSync('src-tauri/icons/128x128.png'), fs.readFileSync('browser-extension/icons/128x128.png'));
});

test('macOS and Windows icon containers keep their native file formats', () => {
  const icns = fs.readFileSync('src-tauri/icons/icon.icns');
  assert.equal(icns.subarray(0, 4).toString(), 'icns');
  assert.equal(icns.readUInt32BE(4), icns.length);
  const ico = fs.readFileSync('src-tauri/icons/icon.ico');
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.ok(ico.readUInt16LE(4) > 0);
});

test('icon regeneration and drift checks are available without a new dependency', () => {
  const scripts = JSON.parse(read('package.json')).scripts;
  assert.equal(scripts['icons:generate'], 'node scripts/generate-keyhub-icons.mjs');
  assert.equal(scripts['test:logo'], 'node --test scripts/test-keyhub-logo.mjs && node scripts/generate-keyhub-icons.mjs --check');
});
