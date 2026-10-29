import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const repo = new URL('../', import.meta.url);

test('README demos are bounded, animated 960x640 GIFs', async () => {
  for (const name of ['keyhub-demo.gif', 'keyhub-demo.zh-CN.gif']) {
    const gif = await fs.readFile(new URL(`.github/assets/${name}`, repo));
    assert.equal(gif.subarray(0, 6).toString(), 'GIF89a', name);
    assert.equal(gif.readUInt16LE(6), 960, name);
    assert.equal(gif.readUInt16LE(8), 640, name);
    assert.ok(gif.length <= 10 * 1024 * 1024, `${name} exceeds README budget: ${gif.length}`);
    assert.ok(gif.includes(Buffer.from('NETSCAPE2.0')), `${name} must loop for README playback`);
  }
});

test('each README embeds its matching-language synthetic product demo', async () => {
  for (const [file, image, caption] of [
    ['README.md', 'keyhub-demo.gif', /isolated test vault/],
    ['README.zh-CN.md', 'keyhub-demo.zh-CN.gif', /隔离的合成密码库/],
  ]) {
    const source = await fs.readFile(new URL(file, repo), 'utf8');
    assert.ok(source.includes(`src=".github/assets/${image}"`), `${file}: ${image}`);
    assert.match(source, caption);
  }
});

test('the demo is reproducible from the synthetic renderer fixture', async () => {
  const packageJson = JSON.parse(await fs.readFile(new URL('package.json', repo), 'utf8'));
  assert.equal(packageJson.scripts['docs:demo'], 'npm run docs:demo:en && npm run docs:demo:zh-CN');
  assert.match(packageJson.scripts['docs:demo:en'], /--language=en/);
  assert.match(packageJson.scripts['docs:demo:zh-CN'], /--language=zh-CN/);
  const script = await fs.readFile(new URL('scripts/capture-readme-demo.mjs', repo), 'utf8');
  for (const text of ['createWorkspaceFixture', 'installWorkspaceFixture', 'recordVideo', 'ffmpeg']) {
    assert.ok(script.includes(text), text);
  }
});
