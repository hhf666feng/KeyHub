import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '../renderer');
const output = await fs.mkdtemp(path.join(os.tmpdir(), 'keyhub-quick-panel-'));
const files = new Map();
for (const name of ['quick.html', 'quick.css', 'quick.js', 'app-mark.svg']) {
  try { files.set(`/${name}`, await fs.readFile(path.join(root, name))); } catch {}
}
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  const body = files.get(pathname === '/' ? '/quick.html' : pathname);
  response.writeHead(body ? 200 : 404, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' })[path.extname(pathname === '/' ? 'quick.html' : pathname)] || 'text/plain' });
  response.end(body || 'Missing quick panel');
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
const results = [];
const audits = [];
const snapshot = {
  language: 'en', menuBarOnly: false, owner: { pinConfigured: true, unlocked: true },
  credentials: [
    { id: 'alpha', name: 'Alpha workspace', itemType: 'api', favorite: false, enabled: false, capabilities: ['http'], secret: 'SYNTHETIC_SECRET_NEVER_RENDER' },
    { id: 'star', name: 'Studio account', itemType: 'login', favorite: true, enabled: true, capabilities: ['fill'] },
    { id: 'inject', name: '<img src=x onerror="window.injected=true">', itemType: 'note', favorite: false, enabled: true, capabilities: [] },
  ],
  activities: [{ id: 'event', time: '2026-10-27T08:00:00Z', status: 'success', connectionName: 'Studio account', action: 'fill', error: 'SYNTHETIC_SECRET_NEVER_RENDER' }],
  agents: [{ clientId: 'synthetic', displayName: 'Synthetic Desktop', detected: true, state: 'connected' }],
  browser: { enabled: true, connected: true, status: 'connected' }, credentialCount: 3, enabledCount: 2,
};

// The single native browser fixture: synthetic Tauri boundary, no real vault.
async function installFixture(context, options = {}) {
  await context.addInitScript(({ initial, theme }) => {
    localStorage.setItem('openkeylet.appearance.v1', JSON.stringify({ theme }));
    const listeners = {};
    window.fixture = {
      state: initial, calls: [], active: 0, maxActive: 0, hold: false, pending: [], fail: false, failAction: false,
      emit: () => listeners['state-changed']?.({ payload: null }),
      release: () => window.fixture.pending.shift()?.(),
    };
    window.__TAURI__ = {
      core: { invoke: async (command, args) => {
        const fixture = window.fixture;
        fixture.calls.push({ command, args });
        if (command === 'quick_state') {
          fixture.active++;
          fixture.maxActive = Math.max(fixture.maxActive, fixture.active);
          const value = structuredClone(fixture.state);
          try {
            if (fixture.hold) await new Promise(resolve => fixture.pending.push(resolve));
            if (fixture.fail) throw new Error('SYNTHETIC_SECRET_NEVER_RENDER');
            return value;
          } finally { fixture.active--; }
        }
        if (command === 'quick_action' && args.action === 'lock') {
          if (fixture.failAction) throw new Error('SYNTHETIC_SECRET_NEVER_RENDER');
          if (fixture.state.owner.pinConfigured) {
            fixture.state.owner.unlocked = false;
            fixture.state.credentials = [];
            fixture.state.activities = [];
          }
          fixture.emit();
        }
        if (!['quick_open_main', 'quick_action'].includes(command)) throw new Error(`Forbidden command: ${command}`);
      } },
      event: { listen: async (name, listener) => { listeners[name] = listener; return () => delete listeners[name]; } },
    };
  }, { initial: { ...structuredClone(snapshot), ...options.state }, theme: options.theme || 'light' });
}
async function fixture(options = {}) {
  const context = await browser.newContext({ viewport: options.viewport || { width: 400, height: 520 }, reducedMotion: 'reduce' });
  await installFixture(context, options);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.locator('#tabs').waitFor({ timeout: 3000 });
  await settle(page);
  return { context, page, errors };
}
async function settle(page) {
  await page.waitForFunction(() => window.fixture.calls.some(call => call.command === 'quick_state') && window.fixture.active === 0);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function check(name, run) {
  try { await run(); results.push({ name, status: 'passed' }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, status: 'failed', error: error.stack }); console.error(`FAIL ${name}: ${error.message}`); }
}
async function lastCall(page) { return page.evaluate(() => window.fixture.calls.at(-1)); }
async function screenshot(page, name) { await page.screenshot({ path: path.join(output, `${name}.png`) }); }

// Measure rendered text and boxes, not source declarations or document overflow alone.
async function auditTypography(page, name) {
  const issues = await page.locator('body').evaluate(() => {
    const problems = [];
    const visible = element => element.getClientRects().length > 0 && !element.closest('[hidden]') && getComputedStyle(element).visibility !== 'hidden';
    const textual = element => [...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
    for (const element of document.querySelectorAll('body *')) {
      if (element.closest('svg') || !visible(element) || !textual(element)) continue;
      const size = parseFloat(getComputedStyle(element).fontSize);
      if (size < 12) problems.push(`text ${element.id || element.className || element.tagName} = ${size}px < 12px (${element.textContent.trim().slice(0, 40)})`);
    }
    for (const element of document.querySelectorAll('.row-title, .tabs button, .footer button, .empty button, #full-window, .search-wrap input')) {
      if (!visible(element)) continue;
      const size = parseFloat(getComputedStyle(element).fontSize);
      if (size < 14) problems.push(`primary ${element.id || element.className || element.tagName} = ${size}px < 14px`);
    }
    for (const element of document.querySelectorAll('.brand > span, #owner, #bridge, .section-heading, #summary, .row-meta, .empty p, #error, .privacy-note')) {
      if (!visible(element)) continue;
      const size = parseFloat(getComputedStyle(element).fontSize);
      if (size < 12 || size > 13) problems.push(`support ${element.id || element.className} = ${size}px outside 12-13px`);
    }
    if (document.documentElement.scrollWidth > innerWidth + 1) problems.push(`document overflows horizontally ${document.documentElement.scrollWidth}/${innerWidth}`);
    if (document.documentElement.scrollHeight > innerHeight + 1) problems.push(`document overflows vertically ${document.documentElement.scrollHeight}/${innerHeight}`);
    const content = document.querySelector('#content');
    if (content) {
      if (content.scrollWidth > content.clientWidth + 1) problems.push(`content overflows horizontally ${content.scrollWidth}/${content.clientWidth}`);
      if (content.clientHeight < 60) problems.push(`content too short to read a row: ${content.clientHeight}px`);
      if (visible(document.querySelector('#error'))) {
        const bounds = content.getBoundingClientRect();
        const hint = content.querySelector('.empty p')?.getBoundingClientRect();
        if (!hint || hint.top < bounds.top || hint.bottom > bounds.bottom - 1) problems.push('error recovery hint is not immediately readable');
      }
      const action = content.querySelector('.empty button');
      if (action) {
        const bounds = content.getBoundingClientRect();
        if (action.getBoundingClientRect().bottom > bounds.bottom - 1) problems.push('empty-state action requires scrolling');
      }
    }
    for (const element of document.querySelectorAll('.header, .brand, .tools, .status-group, #owner, #bridge, .tabs, .search-wrap, .section-heading, #section-title, #summary, #content, #error, .privacy-note, .footer, .footer button, .row, .row-title, .row-meta, .empty strong, .empty p, .empty button')) {
      if (!visible(element)) continue;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (rect.left < -1 || rect.right > innerWidth + 1) problems.push(`outside viewport ${element.id || element.className}`);
      if (!element.closest('#content') && (rect.top < -1 || rect.bottom > innerHeight + 1)) problems.push(`outside panel vertically ${element.id || element.className}`);
      const clips = element.scrollWidth > element.clientWidth + 2;
      if (clips && !(element.matches('.row-title, .row-meta') && style.overflowX === 'hidden' && style.textOverflow === 'ellipsis')) {
        problems.push(`clipped text without ellipsis ${element.id || element.className}`);
      }
    }
    const owner = document.querySelector('.owner-status').getBoundingClientRect();
    const bridge = document.querySelector('#bridge').getBoundingClientRect();
    if (owner.right > bridge.left - 2) problems.push('owner and bridge overlap');
    const title = document.querySelector('#section-title').getBoundingClientRect();
    const summary = document.querySelector('#summary').getBoundingClientRect();
    if (title.right > summary.left - 2) problems.push('section title and summary overlap');
    const expected = document.documentElement.dataset.theme === 'dark'
      ? { '--canvas': '#242428', '--surface': '#29292f', '--ink': '#f4f4f4', '--muted': '#bdbdc8', '--accent': '#ededf1' }
      : { '--canvas': '#f5f5f7', '--surface': '#ffffff', '--ink': '#242428', '--muted': '#65656e', '--accent': '#29292e' };
    for (const [token, value] of Object.entries(expected)) {
      if (getComputedStyle(document.documentElement).getPropertyValue(token).trim() !== value) problems.push(`workspace token mismatch ${token}`);
    }
    if (getComputedStyle(document.querySelector('.status-dot')).boxShadow !== 'none') problems.push('status dot retains glow');
    return problems;
  });
  await screenshot(page, name);
  audits.push({ name, issues });
  return issues;
}

try {
  await check('metadata, favorites, search, injection and navigation', async () => {
    const { context, page, errors } = await fixture();
    try {
      assert.equal(await page.locator('[data-item-id]').first().getAttribute('data-item-id'), 'star');
      assert.equal(await page.locator('[data-item-id]').count(), 3);
      assert.match(await page.locator('#summary').innerText(), /3.*2/);
      assert.match(await page.locator('[data-item-id="alpha"]').innerText(), /Disabled/);
      assert.equal(await page.locator('#content img').count(), 0);
      assert.equal(await page.evaluate(() => window.injected), undefined);
      await screenshot(page, 'light-en-credentials');
      await page.locator('#search').fill('ALPHA');
      assert.equal(await page.locator('[data-item-id]').count(), 1);
      await page.locator('[data-item-id="alpha"]').click();
      assert.deepEqual(await lastCall(page), { command: 'quick_open_main', args: { page: 'connections', itemId: 'alpha' } });
      await page.locator('#search').fill('no-match');
      assert.equal(await page.locator('[data-item-id]').count(), 0);
      assert.match(await page.locator('#content').innerText(), /No matching/);
      await page.locator('#search').fill('');
      await page.locator('[data-tab="agents"]').click();
      assert.match(await page.locator('#content').innerText(), /Synthetic Desktop/);
      await screenshot(page, 'light-en-agents');
      await page.locator('[data-agent-id]').click();
      assert.deepEqual(await lastCall(page), { command: 'quick_open_main', args: { page: 'settings', section: 'MCP' } });
      await page.locator('#bridge').click();
      assert.deepEqual(await lastCall(page), { command: 'quick_open_main', args: { page: 'settings', section: 'WEB' } });
      await page.locator('[data-tab="activity"]').click();
      assert.match(await page.locator('#content').innerText(), /Studio account/);
      await screenshot(page, 'light-en-activity');
      await page.locator('[data-activity-id]').click();
      assert.deepEqual(await lastCall(page), { command: 'quick_open_main', args: { page: 'activity' } });
      for (const [selector, args] of [['#open', { page: 'connections' }], ['#settings', { page: 'settings', section: 'APP' }], ['#full-window', { page: 'connections' }]]) {
        await page.locator(selector).click();
        assert.deepEqual(await lastCall(page), { command: 'quick_open_main', args });
      }
      await page.keyboard.press('Escape');
      assert.deepEqual(await lastCall(page), { command: 'quick_action', args: { action: 'hide' } });
      await page.locator('body').blur();
      assert.deepEqual(await lastCall(page), { command: 'quick_action', args: { action: 'hide' } });
      await page.locator('#quit').click();
      assert.deepEqual(await lastCall(page), { command: 'quick_action', args: { action: 'quit' } });
      assert.doesNotMatch(await page.locator('body').innerText(), /SYNTHETIC_SECRET|Copy secret|Reveal/);
      assert.equal(await page.locator('input[type="password"], textarea, iframe').count(), 0);
      assert.equal(await page.locator('script:not([src]), [onclick], [onerror]').count(), 0);
      assert.match(await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content'), /script-src 'self'; style-src 'self'/);
      assert.equal(await page.evaluate(() => window.fixture.calls.every(call => ['quick_state', 'quick_open_main', 'quick_action'].includes(call.command))), true);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
  await check('locked cold start, PIN setup routing and refresh focus', async () => {
    const { context, page } = await fixture({ state: { owner: { pinConfigured: true, unlocked: false } } });
    try {
      assert.equal(await page.locator('[data-item-id]').count(), 0);
      assert.doesNotMatch(await page.locator('body').innerText(), /Studio account|Alpha workspace/);
      await page.locator('[data-tab="activity"]').click();
      assert.equal(await page.locator('[data-activity-id]').count(), 0);
      await page.evaluate(() => {
        window.fixture.state.owner = { pinConfigured: false, unlocked: true };
        window.dispatchEvent(new Event('focus'));
      });
      await settle(page);
      await page.locator('[data-tab="credentials"]').click();
      assert.equal(await page.locator('[data-item-id]').count(), 3);
      await page.locator('#lock').click();
      await settle(page);
      assert.equal(await page.evaluate(() => window.fixture.calls.some(call => call.command === 'quick_action' && call.args.action === 'lock')), true);
      assert.match(await page.locator('#owner').innerText(), /Set up PIN/);
      assert.equal(await page.evaluate(() => window.fixture.state.owner.unlocked), true);
    } finally { await context.close(); }
  });
  await check('populated dark/zh, keyboard tabs, long list and reduced motion', async () => {
    const credentials = Array.from({ length: 30 }, (_, index) => ({ id: `long-${index}`, name: `Synthetic ${index} ${'Long name '.repeat(20)}`, itemType: 'api', enabled: true, favorite: index === 0, capabilities: ['http'] }));
    const { context, page, errors } = await fixture({ theme: 'dark', state: { language: 'zh', credentials, credentialCount: 30, enabledCount: 30 } });
    try {
      assert.equal(await page.locator('[data-item-id]').count(), 30);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight), true);
      assert.equal(await page.locator('#content').evaluate(element => element.scrollHeight > element.clientHeight && element.scrollWidth <= element.clientWidth), true);
      await page.locator('[data-item-id]').last().scrollIntoViewIfNeeded();
      assert.equal(await page.locator('#full-window').isVisible(), true);
      await screenshot(page, 'dark-zh-long-list');
      await page.locator('[data-tab="credentials"]').focus();
      await page.keyboard.press('ArrowRight');
      assert.equal(await page.locator('[data-tab="agents"]').getAttribute('aria-selected'), 'true');
      await screenshot(page, 'dark-zh-agents');
      await page.keyboard.press('End');
      assert.equal(await page.locator('[data-tab="activity"]').getAttribute('aria-selected'), 'true');
      await screenshot(page, 'dark-zh-activity');
      await page.keyboard.press('Home');
      assert.equal(await page.locator('[data-tab="credentials"]').getAttribute('aria-selected'), 'true');
      assert.equal(await page.locator('.row').first().evaluate(element => getComputedStyle(element).transitionDuration), '0s');
      await page.evaluate(() => window.dispatchEvent(new StorageEvent('storage', { key: 'openkeylet.appearance.v1', newValue: 'not-json' })));
      assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
  await check('single-flight refresh, immediate clearing, stale response rejection and lock', async () => {
    const { context, page } = await fixture();
    try {
      await page.evaluate(() => { window.fixture.hold = true; window.fixture.emit(); });
      assert.equal(await page.locator('[data-item-id]').count(), 0);
      await page.waitForFunction(() => window.fixture.pending.length === 1);
      await page.evaluate(() => {
        window.fixture.state.credentials = [{ id: 'new', name: 'Newest snapshot', enabled: true, capabilities: [] }];
        window.fixture.emit(); window.fixture.emit(); window.dispatchEvent(new Event('focus'));
        window.fixture.release();
      });
      await page.waitForFunction(() => window.fixture.pending.length === 1);
      assert.equal(await page.locator('[data-item-id]').count(), 0);
      await page.evaluate(() => { window.fixture.hold = false; window.fixture.release(); });
      await settle(page);
      assert.equal(await page.locator('[data-item-id="new"]').count(), 1);
      assert.equal(await page.evaluate(() => window.fixture.maxActive), 1);
      await page.evaluate(() => { window.fixture.hold = true; window.fixture.emit(); });
      await page.waitForFunction(() => window.fixture.pending.length === 1);
      await page.locator('#lock').click();
      assert.equal(await page.locator('[data-item-id]').count(), 0);
      await page.evaluate(() => { window.fixture.hold = false; window.fixture.release(); });
      await settle(page);
      assert.equal(await page.locator('[data-item-id]').count(), 0);
      await page.locator('[data-tab="activity"]').click();
      assert.equal(await page.locator('[data-activity-id]').count(), 0);
      await screenshot(page, 'locked');
      await page.evaluate(() => { window.fixture.state.credentials = structuredClone([{ id: 'bad', name: 'Leaked locked metadata' }]); window.fixture.emit(); });
      await settle(page);
      assert.doesNotMatch(await page.locator('body').innerText(), /Leaked locked metadata/);
    } finally { await context.close(); }
  });
  await check('visible sanitized errors and recovery, including lock failure', async () => {
    const { context, page } = await fixture();
    try {
      await page.evaluate(() => { window.fixture.fail = true; window.fixture.emit(); });
      await settle(page);
      assert.equal(await page.locator('#error').isVisible(), true);
      assert.equal(await page.locator('[data-item-id]').count(), 0);
      assert.doesNotMatch(await page.locator('body').innerText(), /SYNTHETIC_SECRET/);
      await screenshot(page, 'error');
      await page.evaluate(() => { window.fixture.fail = false; });
      await page.locator('#refresh').click();
      await settle(page);
      assert.equal(await page.locator('#error').isVisible(), false);
      assert.equal(await page.locator('[data-item-id]').count(), 3);
      await page.evaluate(() => { window.fixture.failAction = true; });
      await page.locator('#lock').click();
      assert.equal(await page.locator('[data-item-id]').count(), 0);
      assert.equal(await page.locator('#error').isVisible(), true);
      await page.locator('#refresh').click();
      await settle(page);
      assert.equal(await page.locator('[data-item-id]').count(), 3);
    } finally { await context.close(); }
  });
  await check('light/dark, en/zh, empty, setup, geometry and storage events', async () => {
    for (const language of ['en', 'zh']) for (const theme of ['light', 'dark']) {
      const { context, page, errors } = await fixture({ theme, state: { language, credentials: [], activities: [], agents: [], credentialCount: 0, enabledCount: 0, owner: { unlocked: true, pinConfigured: false }, browser: { enabled: false, connected: false, status: 'disabled' } } });
      try {
        assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
        assert.equal(await page.locator('html').getAttribute('lang'), language === 'en' ? 'en' : 'zh-CN');
        assert.match(await page.locator('#content').innerText(), language === 'en' ? /No credentials/ : /暂无凭据/);
        assert.match(await page.locator('#owner').innerText(), language === 'en' ? /Set up PIN/ : /设置 PIN/);
        assert.match(await page.locator('#bridge').innerText(), language === 'en' ? /Off/ : /已关闭/);
        const geometry = await page.locator('.panel').boundingBox();
        assert.ok(geometry.width <= 400 && geometry.height <= 520);
        assert.equal(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth), true);
        await screenshot(page, `${theme}-${language}-empty`);
        for (const tab of ['agents', 'activity']) {
          await page.locator(`[data-tab="${tab}"]`).click();
          assert.ok((await page.locator('#content').innerText()).length > 0);
        }
        await page.evaluate(() => window.dispatchEvent(new StorageEvent('storage', { key: 'openkeylet.appearance.v1', newValue: '{"theme":"dark"}' })));
        assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
        await page.setViewportSize({ width: 320, height: 420 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth), true);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    }
  });
  await check('typography, containment and readability audit at 400x520 and 320px', async () => {
    const longCredentials = Array.from({ length: 12 }, (_, index) => ({ id: `row-${index}`, name: `Synthetic credential ${index} ${'Long name '.repeat(12)}`, itemType: 'api', enabled: index % 2 === 0, favorite: index === 0, capabilities: ['http'] }));
    for (const viewport of [{ width: 400, height: 520 }, { width: 320, height: 420 }]) for (const theme of ['light', 'dark']) for (const language of ['en', 'zh']) {
      const name = `audit-${viewport.width}-${theme}-${language}`;
      const { context, page, errors } = await fixture({ viewport, theme, state: { language, credentials: longCredentials, credentialCount: 12, enabledCount: 6 } });
      try {
        await auditTypography(page, `${name}-credentials`);
        for (const tab of ['agents', 'activity']) {
          await page.locator(`[data-tab="${tab}"]`).click();
          await auditTypography(page, `${name}-${tab}`);
        }
        await page.locator('[data-tab="credentials"]').click();
        await page.locator('#search').fill('synthetic-no-match');
        await auditTypography(page, `${name}-no-match`);
        await page.locator('#search').fill('');
        await page.locator('#lock').click();
        await settle(page);
        await auditTypography(page, `${name}-locked`);
        await page.evaluate(() => { window.fixture.state.owner = { unlocked: true, pinConfigured: false }; window.fixture.state.agents = []; window.fixture.emit(); });
        await settle(page);
        await page.locator('[data-tab="agents"]').click();
        await auditTypography(page, `${name}-empty-agents`);
        await page.evaluate(() => { window.fixture.fail = true; window.fixture.emit(); });
        await settle(page);
        await page.locator('[data-tab="credentials"]').click();
        await auditTypography(page, `${name}-error`);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    }
    assert.deepEqual(audits.filter(audit => audit.issues.length), []);
  });
} finally {
  await browser.close();
  server.close();
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ results, audits, screenshots: (await fs.readdir(output)).filter(name => name.endsWith('.png')) }, null, 2));
  console.log(`Report and screenshots: ${output}`);
}
if (results.some(result => result.status === 'failed')) process.exitCode = 1;
