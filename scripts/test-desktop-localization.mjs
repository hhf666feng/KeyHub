import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { startStaticServer } from './fixtures/static-server.mjs';
import { createWorkspaceFixture, installWorkspaceFixture } from './fixtures/workspace.mjs';

const root = path.resolve(import.meta.dirname, '../renderer');
const artifacts = await fs.mkdtemp(path.join(os.tmpdir(), 'keyhub-desktop-localization-'));
const server = await startStaticServer(root);
let browser;
const results = [];
async function check(name, run) {
  try { await run(); results.push({ name, ok: true }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, ok: false, error: error.message }); console.error(`FAIL ${name}: ${error.message}`); }
}
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  for (const language of ['zh', 'en']) {
    const context = await browser.newContext({ viewport: { width: 1200, height: 800 }, reducedMotion: 'reduce' });
    await context.addInitScript(installWorkspaceFixture, createWorkspaceFixture({ language, theme: 'light', empty: true }));
    const page = await context.newPage(); page.setDefaultTimeout(3000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(server.url);
    await page.locator('#add-connection-button').waitFor();
    await page.locator('[data-page="settings"]').click();
    await check(`${language}: Agent states, buttons and bridge statuses use the selected language`, async () => {
      await page.evaluate(async language => {
        workspaceFixture.state.settings.language = language;
        workspaceFixture.state.browserBridge = { enabled: true, paired: true, connected: true, status: 'listening', endpoint: 'ws://127.0.0.1:39272/extension' };
        await refresh();
        agentClients = ['registered', 'available', 'stale', 'conflict', 'error', 'notDetected'].map((state, index) => ({
          clientId: `fixture-${index}`, displayName: ['Codex', 'Cursor', 'Claude Code', 'OpenCode', 'OpenClaw', 'Other Agent'][index],
          detected: state !== 'notDetected', state, canRegister: state === 'available', canRepair: ['stale', 'conflict'].includes(state), canRemove: state === 'registered',
        }));
        renderSettings();
      }, language);
      assert.equal(await page.locator('#mcp-status-strip .status-key').innerText(), language === 'zh' ? '就绪' : 'READY');
      assert.equal(await page.locator('#browser-status-strip .status-key').innerText(), language === 'zh' ? '已连接' : 'CONNECTED');
      assert.deepEqual(await page.locator('.agent-row-action').allTextContents(), language === 'zh' ? ['移除', '连接', '修复', '修复'] : ['REMOVE', 'CONNECT', 'REPAIR', 'REPAIR']);
      if (language === 'zh') assert.doesNotMatch(await page.locator('#page-settings').innerText(), /\b(?:READY|CONNECTED|CONNECT|REMOVE|REPAIR|RESCAN|FAULT|WAITING|ERROR|COPY JSON|COPY TOML)\b/);
      assert.equal(await page.locator('#rescan-agents').innerText(), language === 'zh' ? '重新扫描' : 'RESCAN');
      assert.equal(await page.locator('#agent-restart-notice strong').textContent(), language === 'zh' ? '需要重启 Agent' : 'NEW SESSION REQUIRED');
      await page.screenshot({ path: path.join(artifacts, `settings-${language}.png`) });
    });
    await check(`${language}: editor empty state and private-key controls are localized`, async () => {
      await page.locator('[data-page="connections"]').click();
      await page.locator('#add-connection-button').click();
      await page.locator('[data-item-template="blank"]').click();
      assert.equal(await page.locator('#connection-enabled + span').evaluate(node => getComputedStyle(node, '::before').content), language === 'zh' ? '"开启"' : '"ON"');
      assert.equal(await page.locator('.module-empty b').innerText(), language === 'zh' ? '暂无模块 / 草稿' : 'EMPTY / DRAFT');
      await page.locator('#add-module-button').click(); await page.locator('[data-add-module="privateKey"]').click();
      assert.equal(await page.locator('[data-choose-module-key]').innerText(), language === 'zh' ? '选择文件' : 'SELECT');
      assert.match(await page.locator('.module-key-control').innerText(), language === 'zh' ? /尚未导入/ : /NOT IMPORTED/);
      await page.locator('#connection-name').fill('Synthetic draft');
      await page.locator('#connection-modal [data-close-modal]').first().click();
    });
    await check(`${language}: owner-lock and generator labels do not mix languages`, async () => {
      await page.locator('[data-page="settings"]').click();
      assert.equal(await page.locator('#owner-lock-button').textContent(), language === 'zh' ? '锁定' : 'LOCK');
      await page.locator('#generator-open').click();
      assert.equal(await page.locator('#generator-title').innerText(), language === 'zh' ? '密码生成器' : 'Password generator');
      await page.locator('#generator-close').click();
      await page.evaluate(async () => { workspaceFixture.owner.unlocked = false; await refreshOwnerLock(); });
      assert.equal(await page.locator('#owner-lock-mode').innerText(), language === 'zh' ? '身份验证' : 'OWNER VERIFY');
      assert.equal(await page.locator('#owner-lock-code').innerText(), language === 'zh' ? '已锁定' : 'LOCK');
    });
    assert.deepEqual(errors, []);
    await context.close();
  }
  await fs.writeFile(path.join(artifacts, 'report.json'), `${JSON.stringify(results, null, 2)}\n`);
  console.log(JSON.stringify({ checks: results.length, failed: results.filter(result => !result.ok).length, artifacts }));
  assert.ok(results.every(result => result.ok));
} finally {
  try { await browser?.close(); } finally { await server.close(); }
}
