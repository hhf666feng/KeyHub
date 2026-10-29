import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runScripts, suites } from './run-tests.mjs';

test('suite groups expose offline regressions separately from live integration', () => {
  assert.ok(suites.unit.includes('scripts/test-owner-lock-race.mjs'));
  assert.ok(suites.unit.includes('scripts/test-repository-tools.mjs'));
  assert.ok(suites.ui.includes('scripts/test-env-group.mjs'));
  assert.ok(suites.ui.includes('scripts/test-titlebar.mjs'));
  const offline = Object.values(suites).flat();
  assert.equal(new Set(offline).size, offline.length);
  for (const file of ['test-browser', 'test-login-capture', 'test-login-flows', 'test-keyhub-cli', 'probe-public-logins']) {
    assert.ok(!offline.some(entry => entry.includes(`${file}.mjs`)), file);
  }
});

test('runner preserves order and stops immediately at a failing script', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'keyhub-runner-'));
  try {
    await writeFile(path.join(cwd, 'first.mjs'), 'process.exit(0);');
    await writeFile(path.join(cwd, 'fail.mjs'), 'process.exit(7);');
    await writeFile(path.join(cwd, 'never.mjs'), 'throw new Error("must not run");');
    assert.equal(runScripts(['first.mjs'], { cwd, stdio: 'pipe' }), 0);
    assert.equal(runScripts(['first.mjs', 'fail.mjs', 'never.mjs'], { cwd, stdio: 'pipe' }), 7);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('documented Chromium installation is sufficient for offline UI suites', async () => {
  for (const file of suites.ui) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /channel:\s*['"]chrome['"]/, file);
    assert.doesNotMatch(source, /PLAYWRIGHT_CHANNEL\s*\|\|\s*['"]chrome['"]/, file);
  }
});

test('extension suites resolve the default Cargo target without an environment override', async () => {
  for (const file of ['test-browser', 'test-login-flows', 'test-login-capture']) {
    const source = await readFile(new URL(`./${file}.mjs`, import.meta.url), 'utf8');
    assert.match(source, /process\.env\.CARGO_TARGET_DIR \|\| path\.join\(repo,\s*["']src-tauri\/target["']\)/, file);
  }
});
