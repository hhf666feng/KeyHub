// Synthetic metadata only: does not create passkeys or read browser/vault secrets.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { startStaticServer } from './fixtures/static-server.mjs';
import { createWorkspaceFixture, installWorkspaceFixture } from './fixtures/workspace.mjs';

const root = path.resolve(import.meta.dirname, '../renderer');
const output = await fs.mkdtemp(path.join(os.tmpdir(), 'keyhub-passkey-discovery-'));
const server = await startStaticServer(root);
let browser;
const results = [];
async function check(name, run) {
  try { await run(); results.push({ name, ok: true }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, ok: false, error: error.stack }); console.error(`FAIL ${name}: ${error.stack}`); }
}
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  for (const language of ['zh', 'en']) {
    const fixture = createWorkspaceFixture({ language, theme: 'light', empty: true });
    const context = await browser.newContext({ viewport: { width: 1200, height: 800 }, reducedMotion: 'reduce' });
    await context.addInitScript(installWorkspaceFixture, fixture);
    const page = await context.newPage(); page.setDefaultTimeout(3500);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    await page.goto(server.url);
    await page.locator('.nav [data-page="connections"]').waitFor();
    await check(`${language}: empty Passkey filter explains browser creation and routes to Browser setup`, async () => {
      await page.locator('#add-connection-button').click();
      assert.match(await page.locator('#template-passkey-note').innerText(), language === 'zh' ? /Passkey.*浏览器扩展/ : /Passkey.*browser extension/i);
      await page.screenshot({ path: path.join(output, `${language}-new-item.png`), fullPage: true });
      await page.locator('#connection-modal [data-close-modal]').first().click();
      await page.locator('#connection-modal').waitFor({ state: 'hidden' });
      await page.locator(`[data-item-type-filter="passkey"]`).click();
      assert.match(await page.locator('#connections-list .empty-state h3').innerText(), language === 'zh' ? /还没有 Passkey/ : /No passkeys yet/i);
      assert.match(await page.locator('#connections-list .empty-state p').innerText(), language === 'zh' ? /浏览器.*网站/ : /browser.*website/i);
      await page.screenshot({ path: path.join(output, `${language}-empty.png`), fullPage: true });
      assert.equal(await page.locator('#connections-list [data-workspace-settings="WEB"]').count(), 1);
      await page.locator('#connections-list [data-workspace-settings="WEB"]').click();
      assert.equal(await page.locator('[data-settings-filter="WEB"]').getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('.settings-card[data-module="WEB / 04"]').isVisible(), true);
      assert.equal(await page.evaluate(() => workspaceFixture.calls.some(call => /passkey|owner_secret_view|browser_pair/.test(call.command))), false);
    });
    await check(`${language}: Passkey filter includes passkeys attached to ordinary login items`, async () => {
      await page.evaluate(() => {
        state.connections.push({
          id: 'passkey-login', name: 'Website account', itemType: 'login', description: '', folder: '', favorite: false,
          enabled: true, updatedAt: 'synthetic-passkey-revision', capabilities: ['fill'], canTest: false,
          modules: [{ kind: 'username', value: 'workspace-user', secret: false, agentVisible: false }],
          passkeys: [{ rpId: 'console.example.test', displayName: 'Workspace user', userName: 'workspace-user', credentialId: 'synthetic-credential' }],
          secret: { fields: [] }, passwordHistoryCount: 0,
        });
        render();
      });
      await page.locator('.nav [data-page="connections"]').click();
      await page.locator('[data-item-type-filter="all"]').click();
      await page.locator(`[data-item-type-filter="passkey"]`).click();
      assert.deepEqual(await page.locator('.connection-card').evaluateAll(cards => cards.map(card => card.dataset.itemId)), ['passkey-login']);
      await page.locator('.connection-card .connection-name').click();
      assert.equal(await page.locator('#workspace-detail h2').innerText(), 'Website account');
      assert.equal(await page.evaluate(() => workspaceFixture.calls.filter(call => call.command === 'owner_secret_view').length), 0);
      await page.screenshot({ path: path.join(output, `${language}.png`), fullPage: true });
      assert.deepEqual(errors, []);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    });
    await context.close();
  }
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ checks: results.length, failed: results.filter(result => !result.ok).length, output }));
  assert.ok(results.every(result => result.ok));
} finally {
  try { await browser?.close(); } finally { await server.close(); }
}
