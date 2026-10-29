// Expanded editor geometry with synthetic Tauri; never opens the native vault.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { chromium } from 'playwright';
import { createWorkspaceFixture, installWorkspaceFixture } from './fixtures/workspace.mjs';

const artifacts = await fs.mkdtemp(path.join(os.tmpdir(), 'keyhub-editor-layout-'));
const renderer = path.join(artifacts, 'renderer');
await fs.cp(path.resolve(import.meta.dirname, '../renderer'), renderer, { recursive: true });
const server = http.createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  const file = path.resolve(renderer, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!file.startsWith(`${renderer}${path.sep}`)) { response.writeHead(403).end(); return; }
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

async function audit(page, name) {
  await page.locator('#login-uri-add').scrollIntoViewIfNeeded();
  const issues = await page.locator('#connection-modal').evaluate(editor => {
    const issues = [];
    const add = editor.querySelector('#login-uri-add');
    const rect = add.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(add);
    const lines = [...range.getClientRects()];
    const style = getComputedStyle(add);
    const textWidth = document.createElement('canvas').getContext('2d');
    textWidth.font = style.font;
    const required = textWidth.measureText(add.textContent.trim()).width + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + 2;
    if (rect.width + 1 < required) issues.push(`Add Website label needs ${required.toFixed(1)}px, has ${rect.width}px`);
    if (new Set(lines.map(line => Math.round(line.top))).size !== 1) issues.push('Add Website label wraps onto multiple lines');
    if (lines.some(line => line.top < rect.top || line.bottom > rect.bottom || line.left < rect.left || line.right > rect.right)) issues.push('Add Website text escapes its button');
    if (rect.height < 36 || rect.width < 90) issues.push('Add Website needs a readable text-button hit target');
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    if (hit !== add && !add.contains(hit)) issues.push('Add Website is covered or outside the scrollport');
    const password = editor.querySelector('[data-kind="password"] .module-control');
    const input = password.querySelector('.secret-input-control').getBoundingClientRect();
    const generate = password.querySelector('[data-generate-password]').getBoundingClientRect();
    const gap = Math.max(generate.top - input.bottom, generate.left - input.right);
    if (gap < 6) issues.push(`Password input and Generate need separation, have ${gap}px`);
    for (const element of editor.querySelectorAll('.module-row, .module-control, .login-websites, .login-uri-row')) {
      if (!element.getClientRects().length) continue;
      if (element.scrollWidth > element.clientWidth + 1) issues.push(`${element.className} has clipped or overflowing content`);
      const r = element.getBoundingClientRect();
      if (r.left < 0 || r.right > innerWidth + 1) issues.push(`${element.className} exceeds viewport`);
    }
    return issues;
  });
  await page.screenshot({ path: path.join(artifacts, `${name}.png`), animations: 'disabled' });
  results.push({ name, issues });
}

try {
  for (const width of [1200, 760, 390]) for (const language of ['zh', 'en']) for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width, height: width === 760 ? 600 : 800 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
    const errors = [];
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : (errors.push('External network blocked'), route.abort()));
    await context.routeWebSocket('**/*', socket => { errors.push('WebSocket blocked'); socket.close(); });
    await context.addInitScript(installWorkspaceFixture, createWorkspaceFixture({ language, theme }));
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    page.on('pageerror', error => errors.push(error.message));
    const prefix = `${width}-${language}-${theme}`;
    try {
      await page.goto(origin);
      await page.locator('.connection-card').first().waitFor();
      for (const mode of ['floating', 'inline']) {
        if (mode === 'floating') {
          await page.locator('#add-connection-button').click();
          await page.locator('[data-item-template="login"]').click();
        } else await page.locator('.connection-card[data-item-id="login-acme"] .item-disclosure').click();
        await page.locator('#connection-modal').waitFor({ state: 'visible' });
        const websites = page.locator('#connection-modal .login-websites');
        if (!await websites.evaluate(element => element.open)) await websites.locator('summary').click();
        await audit(page, `${prefix}-${mode}-expanded`);
        const before = await page.locator('.login-uri-row').count();
        await page.locator('#login-uri-add').click();
        await page.locator('#login-uri-add').click();
        assert.equal(await page.locator('.login-uri-row').count(), before + 2);
        await page.locator('[data-login-uri]').last().fill('https://synthetic.example.test/login');
        await page.locator('[data-login-match]').last().selectOption('exact');
        await audit(page, `${prefix}-${mode}-two-websites`);
        await page.locator('[data-remove-uri]').last().click();
        assert.equal(await page.locator('.login-uri-row').count(), before + 1);
        await audit(page, `${prefix}-${mode}-remove-website`);
        await page.locator('#connection-modal [data-close-modal]').first().click();
        await page.locator('#connection-modal').waitFor({ state: 'hidden' });
      }
      assert.deepEqual(errors, []);
      assert.deepEqual(await page.evaluate(() => workspaceFixture.unexpectedCommands), []);
    } catch (error) {
      results.push({ name: `${prefix}-interaction`, issues: [error.stack] });
      await page.screenshot({ path: path.join(artifacts, `${prefix}-error.png`) });
    } finally { await context.close(); }
  }
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
const failed = results.filter(result => result.issues.length);
await fs.writeFile(path.join(artifacts, 'report.json'), JSON.stringify({ results, failed: failed.length }, null, 2));
console.log(JSON.stringify({ checks: results.length, failed: failed.length, artifacts, sampleFailures: failed.slice(0, 3) }, null, 2));
if (failed.length) process.exitCode = 1;
