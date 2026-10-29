import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const repo = new URL('../', import.meta.url);
const gif = await fs.readFile(new URL('.github/assets/keyhub-demo.gif', repo));

test('README demo is a bounded, animated 960x640 GIF', () => {
  assert.equal(gif.subarray(0, 6).toString(), 'GIF89a');
  assert.equal(gif.readUInt16LE(6), 960);
  assert.equal(gif.readUInt16LE(8), 640);
  assert.ok(gif.length <= 10 * 1024 * 1024, `GIF exceeds README budget: ${gif.length}`);
  assert.ok(gif.includes(Buffer.from('NETSCAPE2.0')), 'GIF must loop for README playback');
});

test('both README languages embed the synthetic product demo', async () => {
  for (const file of ['README.md', 'README.zh-CN.md']) {
    const source = await fs.readFile(new URL(file, repo), 'utf8');
    assert.match(source, /src="\.github\/assets\/keyhub-demo\.gif"/);
    assert.match(source, /isolated test vault|隔离的合成密码库/);
  }
});

test('the demo is reproducible from the synthetic renderer fixture', async () => {
  const packageJson = JSON.parse(await fs.readFile(new URL('package.json', repo), 'utf8'));
  assert.equal(packageJson.scripts['docs:demo'], 'node scripts/capture-readme-demo.mjs');
  const script = await fs.readFile(new URL('scripts/capture-readme-demo.mjs', repo), 'utf8');
  for (const text of ['createWorkspaceFixture', 'installWorkspaceFixture', 'recordVideo', 'ffmpeg']) {
    assert.ok(script.includes(text), text);
  }
});
