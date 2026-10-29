// Synthetic renderer only: validates batch KEY=VALUE editing without a native vault.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { startStaticServer } from './fixtures/static-server.mjs';
import { createWorkspaceFixture, installWorkspaceFixture } from './fixtures/workspace.mjs';

const root = path.resolve(import.meta.dirname, '../renderer');
const output = await fs.mkdtemp(path.join(os.tmpdir(), 'keyhub-env-group-'));
const server = await startStaticServer(root);
let browser;
const results = [];
async function check(name, run) {
  try { await run(); results.push({ name, ok: true }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, ok: false, error: error.stack }); console.error(`FAIL ${name}: ${error.stack}`); }
}
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  for (const { language, width } of [{ language: 'zh', width: 1200 }, { language: 'en', width: 390 }]) {
    const fixture = createWorkspaceFixture({ language, theme: width === 390 ? 'dark' : 'light' });
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    await context.addInitScript(installWorkspaceFixture, fixture);
    await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    const page = await context.newPage(); page.setDefaultTimeout(4000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(server.url);
    await page.locator('#add-connection-button').click();
    await page.locator('[data-item-template="blank"]').click();
    const prefix = `${language}-${width}`;

    await check(`${prefix}: env group parses lines, creates editable fields and saves exact names`, async () => {
      await page.locator('#add-module-button').click();
      await page.locator('[data-add-env-group]').click();
      await page.locator('#env-group-composer').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#env-group-input').evaluate(element => element === document.activeElement), true);
      assert.equal(await page.locator('#save-connection-button').isDisabled(), true, 'Composer values cannot be silently skipped by Save');
      await page.locator('#env-group-input').fill([
        '# service configuration',
        'export DATABASE_URL="postgres://user:secret@db.internal/app"',
        'API_TOKEN=token-value-not-real',
        'EMPTY_VALUE=',
        'HASH_VALUE=abc#literal',
      ].join('\n'));
      await page.locator('#connection-modal .modal-header [data-close-modal]').click();
      assert.equal(await page.locator('#connection-modal').isVisible(), true, 'Close cannot discard an unadded composer block');
      assert.match(await page.locator('#env-group-status').innerText(), language === 'zh' ? /识别.*4/ : /4.*parsed/i);
      assert.equal(await page.locator('#env-group-add').isEnabled(), true);
      await page.locator('#env-group-add').click();
      assert.equal(await page.locator('#save-connection-button').isEnabled(), true);
      const fields = page.locator('.module-row[data-kind="customSecret"] [data-module-name]');
      assert.deepEqual(await fields.evaluateAll(nodes => nodes.map(node => node.value)), ['DATABASE_URL', 'API_TOKEN', 'EMPTY_VALUE', 'HASH_VALUE']);
      assert.deepEqual(await page.locator('.module-row[data-kind="customSecret"] [data-secret-value]').evaluateAll(nodes => nodes.map(node => node.value)), ['postgres://user:secret@db.internal/app', 'token-value-not-real', '', 'abc#literal']);
      assert.equal(await page.locator('#env-group-composer').isVisible(), false);
      assert.equal(await page.evaluate(() => workspaceFixture.saved.length), 0, 'Adding fields must not save a credential yet');
      await fields.nth(1).fill('SERVICE_TOKEN');
      await page.locator('#add-module-button').click();
      await page.locator('[data-add-env-group]').click();
      await page.locator('#env-group-input').fill('SERVICE_TOKEN=duplicate');
      assert.match(await page.locator('#env-group-status').innerText(), language === 'zh' ? /已存在/ : /already exists/i);
      await page.locator('#env-group-cancel').click();
      await page.locator('#connection-name').fill('Synthetic env project');
      await page.locator('#save-connection-button').click();
      await page.locator('#connection-modal').waitFor({ state: 'hidden' });
      const saved = await page.evaluate(() => workspaceFixture.saved[0].input);
      assert.deepEqual(saved.modules.map(module => module.name), ['DATABASE_URL', 'SERVICE_TOKEN', 'EMPTY_VALUE', 'HASH_VALUE']);
      assert.equal(saved.secrets.namedSecrets.SERVICE_TOKEN, 'token-value-not-real');
      assert.equal(saved.secrets.namedSecrets.DATABASE_URL, 'postgres://user:secret@db.internal/app');
      assert.equal(saved.secrets.namedSecrets.HASH_VALUE, 'abc#literal');
      assert.deepEqual(await page.evaluate(() => workspaceFixture.calls.filter(call => call.command === 'save_connection').length), 1);
      assert.equal(await page.evaluate(() => workspaceFixture.calls.filter(call => /test_connection|owner_secret_view/.test(call.command)).length), 0);
    });
    await check(`${prefix}: invalid or duplicate keys reject the whole paste without echoing values`, async () => {
      await page.locator('#add-connection-button').click();
      await page.locator('[data-item-template="blank"]').click();
      await page.locator('#add-module-button').click();
      await page.locator('[data-add-env-group]').click();
      await page.locator('#env-group-input').fill('BAD-NAME=secret-one\nOK_KEY=secret-two');
      assert.match(await page.locator('#env-group-status').innerText(), language === 'zh' ? /变量名|格式/ : /name|format/i);
      assert.doesNotMatch(await page.locator('#env-group-status').innerText(), /secret-one|secret-two/);
      assert.equal(await page.locator('.module-row[data-kind="customSecret"]').count(), 0);
      await page.locator('#env-group-input').fill('OK_KEY=secret-two\nok_key=duplicate');
      assert.match(await page.locator('#env-group-status').innerText(), language === 'zh' ? /重复/ : /duplicate/i);
      assert.equal(await page.locator('#env-group-add').isDisabled(), true);
      assert.equal(await page.locator('.module-row[data-kind="customSecret"]').count(), 0);
      await page.locator('#env-group-input').fill('password=internal-conflict\nOTHER_KEY=value');
      assert.equal(await page.locator('#env-group-add').isDisabled(), true);
      assert.equal(await page.locator('.module-row[data-kind="customSecret"]').count(), 0);
      assert.match(await page.locator('#env-group-status').innerText(), language === 'zh' ? /内置/ : /built-in/i);
      await page.locator('#env-group-input').fill('OTHER_KEY=value');
      await page.waitForTimeout(3400);
      await page.screenshot({ path: path.join(output, `${prefix}-composer.png`), fullPage: true });
      await page.locator('#env-group-add').click();
      assert.equal(await page.locator('.module-row[data-kind="customSecret"]').count(), 1);
      assert.equal(await page.locator('.module-row[data-kind="customSecret"] [data-module-name]').inputValue(), 'OTHER_KEY');
      await page.locator('#add-module-button').click();
      await page.locator('[data-add-env-group]').click();
      await page.locator('#env-group-input').fill('NEW_KEY=value\nOTHER_KEY=different');
      assert.match(await page.locator('#env-group-status').innerText(), language === 'zh' ? /已存在/ : /already exists/i);
      assert.equal(await page.locator('#env-group-add').isDisabled(), true);
      await page.locator('#env-group-cancel').click();
      assert.equal(await page.locator('.module-row[data-kind="customSecret"]').count(), 1);
      await page.waitForTimeout(3400);
      await page.screenshot({ path: path.join(output, `${prefix}.png`), fullPage: true });
      assert.equal(await page.locator('#connection-modal').isVisible(), true);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.deepEqual(errors, []);
      await page.locator('#connection-modal [data-close-modal]').first().click();
    });
    await check(`${prefix}: environment variables are a first-class combination`, async () => {
      await page.locator('#add-connection-button').click();
      assert.equal(await page.locator('[data-item-template="env"]').count(), 1);
      assert.match(await page.locator('[data-item-template="env"]').innerText(), language === 'zh' ? /环境变量/ : /Environment variables/i);
      if (language === 'zh') {
        await page.waitForTimeout(3400);
        await page.screenshot({ path: path.join(output, 'zh-templates.png'), fullPage: true });
      }
      await page.locator('[data-item-template="env"]').click();
      assert.equal(await page.locator('#connection-type').inputValue(), 'custom');
      assert.equal(await page.locator('#env-group-composer').isVisible(), true);
      await page.locator('#env-group-input').fill('COMBINATION_KEY=value');
      await page.locator('#env-group-add').click();
      assert.equal(await page.locator('.module-row[data-kind="customSecret"] [data-module-name]').inputValue(), 'COMBINATION_KEY');
      await page.locator('#connection-modal [data-close-modal]').first().click();
      assert.equal(await page.locator('#connection-modal').isVisible(), false);
    });
    await context.close();
  }
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ checks: results.length, failed: results.filter(result => !result.ok).length, output }));
  assert.ok(results.every(result => result.ok));
} finally {
  try { await browser?.close(); } finally { await server.close(); }
}
