// Immutable renderer + synthetic Tauri only. No native vault or external services.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { chromium } from 'playwright';
import { createWorkspaceFixture, installWorkspaceFixture } from './fixtures/workspace.mjs';

const output = await fs.mkdtemp(path.join(os.tmpdir(), 'keyhub-readable-ui-'));
const source = path.join(output, 'renderer');
await fs.cp(path.resolve(import.meta.dirname, '../renderer'), source, { recursive: true });
const server = http.createServer(async (request, response) => {
  const file = path.resolve(source, `.${new URL(request.url, 'http://localhost').pathname.replace(/^\/$/, '/index.html')}`);
  if (!file.startsWith(`${source}${path.sep}`)) { response.writeHead(403).end(); return; }
  try {
    const body = await fs.readFile(file);
    response.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream' }).end(body);
  } catch { response.writeHead(404).end(); }
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
const results = [];

async function audit(page, name, root = 'body') {
  const measurements = await page.locator(root).evaluate(root => {
    const issues = [];
    const visible = element => element.getClientRects().length && !element.closest('.hidden, [hidden]') && getComputedStyle(element).visibility !== 'hidden';
    // Only textual UI, not SVG icons, shortcut glyphs, or decorative template letters.
    for (const element of root.querySelectorAll('*')) {
      if (!visible(element) || element.closest('svg, .title-drag-region, .template-grid button > b, .workspace-row-star, .status-dot, .square-icon, .confirm-icon, .module-action-icon, .module-drag-handle, .icon-button, .item-disclosure, .workspace-reorder, .module-reorder-status')) continue;
      if (![...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && /[\p{L}\p{N}]/u.test(node.textContent))) continue;
      const style = getComputedStyle(element);
      if (parseFloat(style.fontSize) < 12) issues.push(`${element.id || element.className || element.tagName}: ${style.fontSize} (${element.textContent.trim().slice(0, 50)})`);
    }
    for (const element of root.querySelectorAll('.input, .button, .small-button')) {
      if (visible(element) && parseFloat(getComputedStyle(element).fontSize) < 13) issues.push(`${element.id || element.className}: controls must be at least 13px`);
    }
    for (const element of root.querySelectorAll('.module-agent-caption')) {
      if (visible(element) && element.scrollWidth > element.clientWidth + 1) issues.push('Agent visibility caption must not be clipped');
    }
    for (const element of root.querySelectorAll('select.input')) {
      const style = getComputedStyle(element);
      if (visible(element) && style.appearance === 'none' && style.backgroundImage === 'none') issues.push('Custom select must retain a visible dropdown indicator');
    }
    for (const element of root.querySelectorAll('.modal-header h2')) {
      if (visible(element) && parseFloat(getComputedStyle(element).fontSize) < 20) issues.push('Dialog title must be at least 20px');
    }
    for (const element of root.querySelectorAll('.switch span, .module-agent-toggle, .lock-display')) {
      if (visible(element) && getComputedStyle(element).boxShadow !== 'none') issues.push(`${element.className}: legacy inset shadow`);
    }
    for (const element of document.querySelectorAll('.button.primary:disabled')) {
      if (visible(element) && Number(getComputedStyle(element).opacity) > .7) issues.push('Disabled primary action must look disabled');
    }
    if (document.documentElement.scrollWidth > innerWidth + 1) issues.push('Document overflows horizontally');
    for (const element of root.querySelectorAll('.modal-card, .confirm-card, .settings-card, .module-row, .login-uri-row, .owner-lock-panel')) {
      if (!visible(element)) continue;
      const rect = element.getBoundingClientRect();
      if (rect.left < -1 || rect.right > innerWidth + 1) issues.push(`${element.className}: outside viewport`);
      if (element.scrollWidth > element.clientWidth + 2 && !['auto', 'scroll'].includes(getComputedStyle(element).overflowX)) issues.push(`${element.className}: clipped content ${element.scrollWidth}/${element.clientWidth}`);
      if (element.matches('.confirm-card') && element.scrollWidth > element.clientWidth + 1) issues.push('Confirmation text must wrap without horizontal scrolling');
    }
    for (const element of root.querySelectorAll('.modal-card:not(#connection-modal.inline-editor .modal-card) > .modal-header, .modal-backdrop:not(.inline-editor) .modal-footer')) {
      if (!visible(element)) continue;
      const rect = element.getBoundingClientRect();
      if (rect.top < -1 || rect.bottom > innerHeight + 1) issues.push('Dialog header/footer must stay inside viewport');
    }
    return issues;
  });
  const screenshot = `${name}.png`;
  await page.screenshot({ path: path.join(output, screenshot), animations: 'disabled' });
  results.push({ name, issues: measurements, screenshot });
}

async function open(page, selector, modal) {
  await page.locator(selector).click();
  await page.locator(modal).waitFor({ state: 'visible' });
}

async function reachable(page, name, selectors) {
  const issues = [];
  for (const selector of selectors) {
    const element = page.locator(selector);
    await element.scrollIntoViewIfNeeded();
    if (!await element.evaluate(element => {
      const r = element.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return r.top >= 0 && r.bottom <= innerHeight && (hit === element || element.contains(hit));
    })) issues.push(`${selector}: scroll target is clipped or covered`);
  }
  results.push({ name, issues });
}

try {
  for (const viewport of [{ width: 1200, height: 800 }, { width: 760, height: 600 }, { width: 390, height: 844 }]) {
    for (const language of ['zh', 'en']) for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport, reducedMotion: 'reduce', serviceWorkers: 'block' });
      const errors = [];
      await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : (errors.push('External network attempted'), route.abort()));
      await context.routeWebSocket('**/*', socket => { errors.push('WebSocket attempted'); socket.close(); });
      const fixture = createWorkspaceFixture({ language, theme });
      fixture.state.connections[0].passwordHistoryCount = 1;
      fixture.state.connections[1].name = 'X'.repeat(80);
      await context.addInitScript(installWorkspaceFixture, fixture);
      // Read-only history and import cancellation are also isolated in this fixture.
      await context.addInitScript(() => {
        const invoke = window.__TAURI__.core.invoke;
        window.__TAURI__.core.invoke = (command, args) => command === 'owner_password_history'
          ? Promise.resolve({ updatedAt: 'synthetic-revision', entries: [{ changedAt: '2026-01-01T00:00:00Z', password: 'synthetic-old-password' }] })
          : command === 'cancel_import' ? Promise.resolve() : invoke(command, args);
      });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      page.setDefaultTimeout(5000);
      const prefix = `${viewport.width}-${language}-${theme}`;
      try {
        await page.goto(origin);
        await page.locator('.connection-card').first().waitFor();
        await audit(page, `${prefix}-vault`);
        await page.locator('#title-search-input').fill('synthetic-no-matching-item');
        await audit(page, `${prefix}-vault-no-match`);
        await page.locator('#title-search-input').fill('');
        await open(page, '#add-connection-button', '#connection-modal');
        await audit(page, `${prefix}-add`, '#connection-modal');
        await page.locator('#add-module-button').scrollIntoViewIfNeeded();
        await audit(page, `${prefix}-add-bottom`, '#connection-modal');
        await page.locator('[data-item-template="login"]').click();
        await audit(page, `${prefix}-modules`, '#connection-modal');
        await page.locator('#add-module-button').click();
        await audit(page, `${prefix}-module-menu`, '#module-menu');
        await page.locator('[data-add-env-group]').click();
        await page.locator('#env-group-input').fill('SYNTHETIC_API_TOKEN=not-a-real-secret');
        await audit(page, `${prefix}-env-group`, '#connection-modal');
        await page.locator('#env-group-cancel').click();
        await page.locator('#connection-modal [data-close-modal]').first().click();
        // Close through the actual draft path rather than erasing editor state.
        await page.locator('#connection-modal').waitFor({ state: 'hidden' });
        await page.locator('.connection-card[data-item-id="login-acme"] .item-disclosure').click();
        await audit(page, `${prefix}-inline`, '#connection-modal');
        await page.locator('#connection-modal [data-close-modal]').first().click();
        await page.locator('[data-page="activity"]').click();
        await audit(page, `${prefix}-activity`);
        await page.locator('.activity-error').click();
        await audit(page, `${prefix}-activity-error`);
        await open(page, '#clear-activity-button', '#confirmation-modal');
        await audit(page, `${prefix}-confirmation`, '#confirmation-modal');
        await page.locator('#confirmation-cancel').click();
        await page.locator('[data-page="connections"]').click();
        await page.locator('.connection-card[data-item-id="login-personal"] .workspace-more').click();
        await open(page, '.connection-card[data-item-id="login-personal"] [data-action="delete"]', '#confirmation-modal');
        await audit(page, `${prefix}-long-name-confirmation`, '#confirmation-modal');
        await page.locator('#confirmation-cancel').click();
        await page.locator('[data-page="settings"]').click();
        await audit(page, `${prefix}-settings`);
        await page.locator('#title-search-input').fill('synthetic-no-matching-setting');
        await audit(page, `${prefix}-settings-no-match`);
        await page.locator('#title-search-input').fill('');
        for (const section of ['SYSTEM', 'MCP', 'APP', 'WEB', 'CLOUD', 'SAFE']) {
          const selector = `.settings-card[data-module^="${section}"]`;
          await page.locator(selector).scrollIntoViewIfNeeded();
          await audit(page, `${prefix}-settings-${section.toLowerCase()}`, selector);
        }
        for (const [trigger, modal, close] of [
          ['#generator-open', '#generator-modal', '#generator-close'],
          ['#header-export-backup-button', '#backup-password-modal', '#backup-password-close'],
          ['#migration-open', '#migration-modal', '#migration-close'],
          ['#trash-open', '#vault-management-modal', '#vault-management-close'],
          ['#github-connect', '#github-modal', '#github-modal-close'],
        ]) {
          await open(page, trigger, modal);
          await audit(page, `${prefix}-${modal.slice(1)}`, modal);
          if (modal === '#generator-modal') await reachable(page, `${prefix}-generator-actions`, ['#generator-length', '#generator-copy']);
          await page.locator(close).click();
        }
        await page.locator('[data-page="connections"]').click();
        await page.locator('.connection-card[data-item-id="login-acme"] .workspace-more').click();
        await open(page, '.connection-card[data-item-id="login-acme"] [data-action="history"]', '#vault-management-modal');
        await audit(page, `${prefix}-history`, '#vault-management-modal');
        await page.locator('#vault-management-close').click();
        await page.locator('#owner-lock-button').click();
        await page.locator('#owner-lock-layer').waitFor({ state: 'visible' });
        await audit(page, `${prefix}-lock`, '#owner-lock-layer');
        await reachable(page, `${prefix}-lock-fields`, ['#owner-pin', '#owner-unlock-action']);
        await page.evaluate(async () => {
          workspaceFixture.owner = { pinConfigured: false, unlocked: true, expiresInSeconds: 0 };
          await workspaceFixture.emit('state-changed');
          await workspaceFixture.emit('pin-setup-requested');
        });
        await page.locator('#owner-pin-confirm-field').waitFor({ state: 'visible' });
        await audit(page, `${prefix}-pin-setup`, '#owner-lock-layer');
        await reachable(page, `${prefix}-pin-setup-fields`, ['#owner-pin', '#owner-pin-confirm', '#owner-unlock-action', '#owner-pin-cancel']);
        assert.deepEqual(errors, []);
        assert.deepEqual(await page.evaluate(() => workspaceFixture.unexpectedCommands), []);
      } catch (error) {
        results.push({ name: `${prefix}-interaction`, issues: [error.stack] });
        await page.screenshot({ path: path.join(output, `${prefix}-error.png`) });
      } finally { await context.close(); }
    }
  }
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
const failed = results.filter(result => result.issues.length);
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ results, failed: failed.length }, null, 2));
console.log(JSON.stringify({ checks: results.length, failed: failed.length, output, sampleFailures: failed.slice(0, 5) }, null, 2));
if (failed.length) process.exitCode = 1;
