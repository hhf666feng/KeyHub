import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
assert.ok(args.length === 0 || (args.length === 1 && args[0] === '--check'), 'Use --check or no arguments');
const check = args[0] === '--check';
const source = path.join(root, 'renderer/app-mark.svg');
const cli = path.join(root, 'node_modules/@tauri-apps/cli/tauri.js');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'keyhub-icons-'));
const generated = path.join(temporary, 'native');
const sizes = [16, 20, 24, 32, 40, 42, 48, 53, 63, 64, 84, 105, 126, 128, 168];

function generate(output, pngSizes = []) {
  const flags = pngSizes.flatMap(size => ['--png', String(size)]);
  const result = spawnSync(process.execPath, [cli, 'icon', source, '--output', output, ...flags], {
    cwd: root, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(result.error?.message || result.stderr || result.stdout || 'Tauri icon generation failed');
  }
}

function assetBytes(file) {
  const data = fs.readFileSync(file);
  if (!file.endsWith('.icns')) return data;
  assert.equal(data.subarray(0, 4).toString(), 'icns');
  assert.equal(data.readUInt32BE(4), data.length);
  const chunks = [];
  for (let offset = 8; offset < data.length;) {
    assert.ok(offset + 8 <= data.length, 'Truncated ICNS entry');
    const length = data.readUInt32BE(offset + 4);
    assert.ok(length >= 8 && offset + length <= data.length, 'Invalid ICNS entry');
    chunks.push(data.subarray(offset, offset + length));
    offset += length;
  }
  // Tauri emits a hash-map iteration order; stabilize the container, not its pixels.
  chunks.sort((a, b) => Buffer.compare(a.subarray(0, 4), b.subarray(0, 4)));
  return Buffer.concat([data.subarray(0, 8), ...chunks]);
}

try {
  generate(generated);
  const pngs = path.join(temporary, 'png');
  generate(pngs, sizes);
  const assets = new Map();
  for (const file of ['32x32.png', '128x128.png', '128x128@2x.png', 'icon.icns', 'icon.ico']) {
    assets.set(`src-tauri/icons/${file}`, path.join(generated, file));
  }
  for (const size of [16, 20, 24, 32, 40, 48, 64]) {
    assets.set(`renderer/app-mark-${size}.png`, path.join(pngs, `${size}x${size}.png`));
  }
  for (const size of [16, 32, 42, 48, 53, 63, 84, 105, 126, 128, 168]) {
    assets.set(`browser-extension/icons/${size}x${size}.png`, path.join(pngs, `${size}x${size}.png`));
  }
  // Shared sizes use exactly the same rasterizer output on every product surface.
  assets.set('src-tauri/icons/32x32.png', path.join(pngs, '32x32.png'));
  assets.set('src-tauri/icons/128x128.png', path.join(pngs, '128x128.png'));
  const stale = [];
  for (const [relative, output] of assets) {
    const target = path.join(root, relative);
    const data = assetBytes(output);
    if (check) {
      if (!fs.existsSync(target) || !data.equals(fs.readFileSync(target))) stale.push(relative);
    } else {
      fs.writeFileSync(target, data);
    }
  }
  assert.deepEqual(stale, [], 'Icons differ from renderer/app-mark.svg; run npm run icons:generate');
  console.log(`${check ? 'Verified' : 'Generated'} ${assets.size} KeyHub icon assets from renderer/app-mark.svg`);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
