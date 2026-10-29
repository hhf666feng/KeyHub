// Isolated renderer fixture: no desktop vault or real credentials are used.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { once } from 'node:events';
import { chromium } from 'playwright';

const source = path.resolve(import.meta.dirname, '../renderer');
const artifacts = await fs.mkdtemp(path.join(os.tmpdir(), 'openkeylet-inline-ui-'));
const geometryMeasurements = [];
const stateMeasurements = [];
const visualFailures = [];
let functionalChecksPassed = false;
// Freeze the renderer so concurrent production edits cannot mix versions mid-run.
const renderer = path.join(artifacts, 'renderer-snapshot');
await fs.cp(source, renderer, { recursive: true });
console.log(`Inline editor artifacts: ${artifacts}`);
const server = http.createServer(async (req, res) => {
  const pathname = decodeURIComponent(req.url.split('?')[0]);
  const file = path.resolve(renderer, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(renderer + path.sep)) { res.writeHead(403); res.end(); return; }
  try {
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : 'text/html');
    res.end(await fs.readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
let page;
try {
  page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1.5 });
  page.setDefaultTimeout(5000);
  // Poll with evaluate instead of waitForFunction, which requires CSP-blocked eval.
  const waitUntil = async (predicate, argument) => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (await page.evaluate(predicate, argument)) return;
      await page.waitForTimeout(25);
    }
    assert.fail(`Renderer did not settle: ${predicate}`);
  };
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    // Exercise both integration switches even when Chrome is hosted on macOS.
    Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
    Object.defineProperty(navigator, 'userAgent', { get: () => 'OpenKeylet synthetic Windows fixture' });
    window.setInterval = () => 0;
    const item = (id, name, capabilities) => ({
      id, name, capabilities, itemType: 'custom', description: 'Hidden synthetic description',
      enabled: true, canTest: true, updatedAt: 'revision-1', passkeys: [], folder: '', favorite: id === 'alpha',
      modules: [{ kind: 'url', value: 'https://example.test', agentVisible: true }, { kind: 'password', value: '', configured: true, agentVisible: false }],
      secret: { fields: [] }, passwordHistoryCount: 1,
    });
    const state = {
      settings: { language: 'en', closeBehavior: 'tray', browserEnabled: true, browserPort: 39272 },
      connections: [item('alpha', 'Synthetic service with a very long name', ['http']), item('beta', 'Synthetic server', ['ssh']), { ...item('gamma', 'Synthetic password', ['fill']), itemType: 'login' }],
      activities: [
        { id: 'ok', action: 'Synthetic success', connectionName: 'Synthetic server', status: 'success', source: 'mcp', durationMs: 42, time: new Date().toISOString() },
        { id: 'error', action: 'Synthetic failure', connectionName: 'Synthetic API', status: 'error', source: 'mcp', durationMs: 60, error: 'Fixture failure', time: new Date().toISOString() },
      ], mcp: { status: 'ready', endpoint: 'fixture', stdioCommand: 'fixture' },
      browserBridge: { status: 'listening', enabled: true, connected: true, paired: true, endpoint: 'fixture' },
      security: { encrypted: true, storage: 'fixture' },
    };
    window.fixture = { state, drafts: [], saved: [], orders: [], orderRequests: 0, revision: 1, failDraft: false, failOrder: false, staleOrder: false, saveRequests: [], orderAttempts: [], deleted: [], secretReads: [],
      owner: { pinConfigured: false, unlocked: true }, integrations: { desktopShortcut: false, launchAtLogin: false },
      integrationWrites: [], settingsWrites: [], failIntegration: false, pinDisables: 0 };
    window.__TAURI__ = { event: { listen: async () => () => {} }, core: { invoke: async (command, args = {}) => {
      if (command === 'get_state') return structuredClone(state);
      if (command === 'owner_status') return structuredClone(fixture.owner);
      if (command === 'owner_disable_pin') { fixture.pinDisables++; fixture.owner.pinConfigured = false; return structuredClone(fixture.owner); }
      if (command === 'owner_editor_drafts') return structuredClone(fixture.drafts);
      if (command === 'agent_mcp_status') return [
        { clientId: 'fixture-ready', displayName: 'Synthetic agent', state: 'available', canRegister: true },
        { clientId: 'fixture-stale', displayName: 'Synthetic stale agent', state: 'stale', canRepair: true, canRemove: true },
      ];
      if (command === 'github_backup_status') return { connected: false };
      if (command === 'system_integration_status') return structuredClone(fixture.integrations);
      if (command === 'set_desktop_shortcut' || command === 'set_launch_at_login') {
        fixture.integrationWrites.push({ command, enabled: args.enabled });
        if (fixture.failIntegration) throw Error('Synthetic integration failure');
        fixture.integrations[command === 'set_desktop_shortcut' ? 'desktopShortcut' : 'launchAtLogin'] = args.enabled;
        return structuredClone(fixture.integrations);
      }
      if (command === 'update_settings') { fixture.settingsWrites.push(args.patch); Object.assign(state.settings, args.patch); return state.settings; }
      if (command === 'owner_secret_view') { fixture.secretReads.push(args.id); return { fields: [{ name: 'password', value: 'synthetic-password' }] }; }
      if (command === 'generate_password') return 'Aa1!'.repeat(32).slice(0, args.options.length);
      if (command === 'save_editor_draft') {
        if (fixture.failDraft) throw Error('Synthetic draft failure');
        const draft = { id: args.draftId || `draft-${args.input.id || 'new'}`, input: structuredClone(args.input) };
        fixture.drafts = [draft, ...fixture.drafts.filter(d => d.id !== draft.id)]; return draft;
      }
      if (command === 'delete_editor_draft') { fixture.drafts = fixture.drafts.filter(d => d.id !== args.id); return; }
      if (command === 'save_connection') {
        fixture.saveRequests.push(structuredClone(args));
        const index = state.connections.findIndex(i => i.id === args.input.id);
        const existing = state.connections[index];
        if (existing && args.expectedUpdatedAt !== existing.updatedAt) throw Error('Stale edit');
        fixture.saved.push(structuredClone(args.input));
        const saved = { ...existing, ...args.input, updatedAt: `revision-${++fixture.revision}` };
        state.connections[index] = saved; return saved;
      }
      if (command === 'delete_connection') { fixture.deleted.push(structuredClone(args)); state.connections = state.connections.filter(i => i.id !== args.id); return; }
      if (command === 'reorder_connections') {
        fixture.orderRequests += 1;
        fixture.orderAttempts.push(structuredClone(args));
        if (fixture.staleOrder) {
          fixture.staleOrder = false;
          [state.connections[1], state.connections[2]] = [state.connections[2], state.connections[1]];
        }
        if (fixture.failOrder) throw Error('Synthetic reorder failure');
        if (JSON.stringify(state.connections.map(i => i.id)) !== JSON.stringify(args.expectedOrder)) throw Error('Stale order');
        if (new Set(args.ids).size !== state.connections.length || args.ids.some(id => !state.connections.some(i => i.id === id))) throw Error('Invalid order');
        state.connections = args.ids.map(id => state.connections.find(i => i.id === id));
        fixture.orders.push(args.ids); return;
      }
      return {};
    } } };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('.connection-card').first().waitFor();
  const row = id => page.locator(`.connection-card[data-item-id="${id}"]`);
  const toggle = id => row(id).locator('.item-disclosure');
  const editor = page.locator('#connection-modal');
  const search = page.locator('#title-search-input');
  const fillSearch = async value => {
    if (!await search.isVisible()) await page.locator('#title-search-toggle').click();
    await search.fill(value);
  };
  const selectFilter = async (selector, value, expected = value) => {
    const strip = page.locator(selector);
    await strip.locator(`[data-${selector === '#item-type-switch' ? 'item-type' : selector === '#activity-filter-switch' ? 'activity' : 'settings'}-filter="${value}"]`).click();
    await waitUntil(({ selector, expected }) => {
      const button = document.querySelector(`${selector} [aria-pressed="true"]`);
      return button && Object.values(button.dataset).includes(expected);
    }, { selector, expected });
  };
  const dragSwitch = async (selector, from, to, { count = 2, cancel = false, settle = true } = {}) => {
    const control = page.locator(selector);
    await control.scrollIntoViewIfNeeded();
    const box = await control.boundingBox();
    const inset = await control.evaluate(el => parseFloat(getComputedStyle(el).paddingLeft));
    const cell = (box.width - 2 * inset) / count, y = box.y + box.height / 2;
    await page.mouse.move(box.x + inset + cell * (from + .5), y); await page.mouse.down();
    await page.mouse.move(box.x + inset + cell * (to + .5), y, { steps: 8 });
    assert.equal(await control.evaluate(el => el.classList.contains('is-dragging')), true, `${selector} must drag its cap`);
    if (cancel) { await page.keyboard.press('Escape'); await page.waitForTimeout(60); }
    await page.mouse.up();
    if (settle) await waitUntil(selector => !document.querySelector(selector).hasAttribute('aria-busy'), selector);
  };
  const auditWorkspaceStates = async () => {
    const states = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d');
      const luminance = color => {
        context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1);
        return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map(v => v / 255)
          .map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
          .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
      };
      return [...document.querySelectorAll('.switch, .module-agent-toggle')].filter(el => el.getBoundingClientRect().width).map(el => {
        const module = el.matches('.module-agent-toggle');
        const input = el.querySelector('input');
        const enabled = module ? el.getAttribute('aria-pressed') === 'true' : input.checked;
        const well = module ? el : el.querySelector('span');
        const label = getComputedStyle(well, module ? '::after' : '::before');
        const glyph = getComputedStyle(module ? el.querySelector('i') : well, module ? '::before' : '::after');
        const [lo, hi] = [luminance(label.color), luminance(getComputedStyle(well).backgroundColor)].sort((a, b) => a - b);
        const caption = module ? el.closest('.module-row').querySelector('[data-module-visibility]').textContent : null;
        const zh = document.documentElement.lang.startsWith('zh');
        return { id: input?.id || el.closest('.module-row').dataset.kind, module, language: document.documentElement.lang, theme: document.documentElement.dataset.theme,
          enabled, disabled: module ? el.disabled : input.disabled,
          word: label.content.replaceAll('"', ''), glyph: glyph.content.replaceAll('"', ''), contrast: (hi + .05) / (lo + .05),
          caption, expectedCaption: zh ? `Agent ${enabled ? '\u53ef\u89c1' : '\u9690\u85cf'}` : `AGENT ${enabled ? 'VISIBLE' : 'HIDDEN'}`,
          accessibleName: module ? el.getAttribute('aria-label') : null,
          expectedName: zh ? enabled ? 'Agent \u53ef\u89c1\uff0c\u70b9\u51fb\u5173\u95ed\u53ef\u89c1\u6027' : 'Agent \u9690\u85cf\uff0c\u70b9\u51fb\u5141\u8bb8 Agent \u67e5\u770b' : enabled ? 'Agent visible. Click to hide.' : 'Hidden from agent. Click to make visible.',
          expectedWord: module ? zh ? enabled ? '\u53ef\u89c1' : '\u9690\u85cf' : enabled ? 'SHOW' : 'HIDE' : zh ? enabled ? '\u5f00\u542f' : '\u5173\u95ed' : enabled ? 'ON' : 'OFF' };
      });
    });
    stateMeasurements.push(states);
    assert.ok(states.length, 'Inspect at least one binary control');
    for (const state of states) {
      assert.equal(state.word, state.expectedWord, `${state.id}: visible switch state`);
      assert.equal(state.glyph, state.enabled ? '\u2713' : '\u2212', `${state.id}: redundant state glyph`);
      if (state.caption !== null) {
        assert.equal(state.caption, state.expectedCaption);
        assert.equal(state.accessibleName, state.expectedName, 'Agent visibility must have a synchronized accessible name');
      }
      // Keep accessibility failures fatal to the run without hiding later behavior checks.
      if (!state.disabled && (!Number.isFinite(state.contrast) || state.contrast < 4.5)) visualFailures.push({ check: 'binary state text contrast >= 4.5:1', ...state });
    }
  };
  const auditWorkspaceGeometry = async () => {
    const report = await page.evaluate(() => {
      const failures = [], records = [];
      if (document.documentElement.scrollWidth > innerWidth + 1) failures.push('document overflows horizontally');
      const selectors = '.title-drag-region, .workspace-toolbar, .workspace-summary, .workspace-sidebar, #workspace-detail, .connection-card, .settings-card, #connection-modal, .activity-item';
      for (const el of document.querySelectorAll(selectors)) {
        const box = el.getBoundingClientRect(), style = getComputedStyle(el);
        if (!box.width || !box.height || style.visibility === 'hidden') continue;
        const label = el.id || el.className;
        records.push({ label, x: box.x, width: box.width, height: box.height });
        if (box.left < -1 || box.right > innerWidth + 1) failures.push(`${label}: outside viewport`);
        if (el.scrollWidth > el.clientWidth + 1 && !['auto', 'scroll'].includes(style.overflowX)) failures.push(`${label}: clipped horizontal content`);
      }
      return { width: innerWidth, scale: devicePixelRatio, language: document.documentElement.lang, theme: document.documentElement.dataset.theme, records, failures };
    });
    geometryMeasurements.push(report);
    assert.deepEqual(report.failures, [], `Workspace geometry: ${JSON.stringify(report)}`);
    assert.ok(report.records.length, 'Inspect visible workspace regions');
    return report;
  };
  const requireVisible = async selectors => {
    for (const selector of selectors) {
      const control = page.locator(selector);
      assert.equal(await control.isVisible(), true, `${selector} must remain visible`);
      await control.scrollIntoViewIfNeeded();
      const box = await control.boundingBox();
      const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
      assert.ok(box.x >= -1 && box.x + box.width <= viewport.width + 1 && box.y < viewport.height && box.y + box.height > 0,
        `${selector} must be reachable in the viewport: ${JSON.stringify(box)}`);
    }
  };
  const display = await page.context().newCDPSession(page);
  for (const language of ['en', 'zh']) for (const theme of ['dark', 'light']) {
    await page.locator(`[data-language="${language}"]`).click();
    if (await page.locator('html').getAttribute('data-theme') !== theme) await page.locator('#theme-toggle').click();
    for (const width of [390, 460, 760, 1200]) {
      for (const scale of [1, 1.25, 1.5, 2]) {
        await display.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: scale, mobile: false });
        await auditWorkspaceGeometry();
      }
      await requireVisible(['#theme-toggle', '#language-switch', '.nav', '#title-search-input', '#add-connection-button', '[data-item-type-filter="all"]']);
      await row('alpha').locator('.workspace-reorder[data-item-reorder]').scrollIntoViewIfNeeded();
      await requireVisible(['.connection-card[data-item-id="alpha"] .workspace-reorder', '.connection-card[data-item-id="alpha"] .item-disclosure']);
      await page.screenshot({ path: path.join(artifacts, `workspace-${width}-${language}-${theme}.png`) });
    }
    await page.locator('[data-page="settings"]').click();
    for (const width of [390, 460, 760, 1200]) {
      await display.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1.5, mobile: false });
      await selectFilter('#settings-filter-switch', 'all');
      await auditWorkspaceGeometry();
      for (const section of ['MCP', 'APP', 'WEB', 'CLOUD', 'SAFE']) {
        await selectFilter('#settings-filter-switch', section);
        assert.equal(await page.locator('.settings-card:visible').count(), 1);
        if (section === 'MCP') await page.locator('.manual-mcp-config summary').click();
        if (section === 'WEB') await page.locator('.browser-install-fallback summary').click();
        await auditWorkspaceGeometry();
        if (section === 'MCP') await page.locator('.manual-mcp-config summary').click();
        if (section === 'WEB') await page.locator('.browser-install-fallback summary').click();
      }
    }
    await selectFilter('#settings-filter-switch', 'all');
    await page.locator('[data-page="connections"]').click();
  }
  await display.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 900, deviceScaleFactor: 1.5, mobile: false });
  await page.locator('[data-language="en"]').click();
  // Historical failures must not become the current Browser Bridge status.
  const metrics = page.locator('.workspace-metric');
  assert.equal(await metrics.first().locator('strong').innerText(), '3');
  assert.match(await metrics.first().getAttribute('title'), /3 enabled/);
  assert.equal(await metrics.nth(2).locator('strong').innerText(), 'Connected');
  await page.evaluate(async () => { fixture.state.connections[1].enabled = false; await refresh(false); });
  assert.equal(await metrics.first().locator('strong').innerText(), '3');
  assert.match(await metrics.first().getAttribute('title'), /2 enabled/);
  await page.evaluate(async () => { fixture.state.connections[1].enabled = true; await refresh(false); });
  for (const [status, paired, connected, enabled, expected] of [
    ['listening', false, false, true, 'Not paired'], ['listening', true, false, true, 'Waiting for extension'],
    ['off', true, false, false, 'Off'], ['error', true, false, true, 'Connection error'],
  ]) {
    await page.evaluate(async values => { Object.assign(fixture.state.browserBridge, values); await refresh(false); }, { status, paired, connected, enabled });
    assert.equal(await metrics.nth(2).locator('strong').innerText(), expected);
    assert.match(await metrics.first().getAttribute('title'), /3 enabled/);
  }
  await page.evaluate(async () => { Object.assign(fixture.state.browserBridge, { status: 'listening', paired: true, connected: true, enabled: true }); await refresh(false); });
  // Retained title/language/binary switches still use drag, cancel and single commit.
  await dragSwitch('#theme-toggle', 1, 0);
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  await dragSwitch('#theme-toggle', 0, .3);
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark', 'Returning to the same gear must not toggle it');
  await dragSwitch('#theme-toggle', 0, 1, { cancel: true });
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  // Sound is hidden in the workspace; test preference persistence via its public API.
  await page.evaluate(() => OpenKeyletAppearance.setSound(true));
  assert.equal(await page.locator('#sound-toggle').getAttribute('aria-checked'), 'true');
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('openkeylet.appearance.v1'))), { theme: 'dark', sound: true });
  await page.reload(); await page.locator('.connection-card').first().waitFor();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  assert.equal(await page.locator('#sound-toggle').getAttribute('aria-checked'), 'true');
  await page.evaluate(() => OpenKeyletAppearance.setSound(false));
  await dragSwitch('#theme-toggle', 0, 1);
  await dragSwitch('#language-switch', 0, 1);
  assert.equal(await page.locator('html').getAttribute('lang'), 'zh-CN');
  await dragSwitch('#language-switch', 1, 0);
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  assert.equal(await page.evaluate(() => fixture.state.settings.language), 'en');
  await page.locator('[data-page="settings"]').click();
  assert.equal(await page.locator('.page.active').getAttribute('id'), 'page-settings');
  await auditWorkspaceGeometry();
  await auditWorkspaceStates();
  await dragSwitch('.switch:has(#desktop-shortcut-enabled)', 0, 1);
  assert.equal(await page.locator('#desktop-shortcut-enabled').isChecked(), true);
  assert.equal(await page.evaluate(() => fixture.integrationWrites.length), 1, 'A drag must not also fire the label click');
  await dragSwitch('.switch:has(#desktop-shortcut-enabled)', 1, 0);
  assert.equal(await page.locator('#desktop-shortcut-enabled').isChecked(), false);
  await page.evaluate(() => fixture.failIntegration = true);
  await dragSwitch('.switch:has(#launch-at-login-enabled)', 0, 1);
  assert.equal(await page.locator('#launch-at-login-enabled').isChecked(), false, 'A failed save restores the switch');
  await page.evaluate(() => fixture.failIntegration = false);
  await dragSwitch('.switch:has(#launch-at-login-enabled)', 0, 1);
  await dragSwitch('.switch:has(#launch-at-login-enabled)', 1, 0);
  await dragSwitch('.switch:has(#browser-enabled)', 1, 0);
  assert.equal(await page.evaluate(() => fixture.state.settings.browserEnabled), false);
  await dragSwitch('.switch:has(#browser-enabled)', 0, 1);
  assert.equal(await page.evaluate(() => fixture.state.settings.browserEnabled), true);
  await page.evaluate(async () => { fixture.owner.pinConfigured = true; await refreshOwnerLock(); renderSettings(); });
  await dragSwitch('.switch:has(#pin-enabled)', 1, 0, { settle: false });
  await page.locator('#confirmation-modal').waitFor({ state: 'visible' });
  assert.equal(await page.evaluate(() => fixture.pinDisables), 0, 'PIN drag retains confirmation before removal');
  await waitUntil(() => document.activeElement.id === 'confirmation-cancel');
  await page.locator('#confirmation-cancel').click();
  await waitUntil(() => !document.querySelector('#pin-enabled').closest('.switch').hasAttribute('aria-busy'));
  assert.equal(await page.locator('#pin-enabled').isChecked(), true);
  await dragSwitch('.switch:has(#pin-enabled)', 1, 0, { settle: false });
  await page.locator('#confirmation-accept').click();
  await waitUntil(() => !document.querySelector('#pin-enabled').closest('.switch').hasAttribute('aria-busy'));
  assert.equal(await page.evaluate(() => fixture.pinDisables), 1);
  assert.equal(await page.locator('#pin-enabled').isChecked(), false);
  await page.locator('[data-page="activity"]').click();
  assert.equal(await page.locator('.page.active').getAttribute('id'), 'page-activity');
  assert.equal(await page.locator('[data-page="activity"]').getAttribute('aria-current'), 'page');
  await page.locator('[data-page="connections"]').click();
  assert.equal(await page.locator('#drafts-button').isDisabled(), true, 'An unavailable draft cannot be opened');
  assert.equal(await editor.isHidden(), true);
  assert.equal(await page.locator('#add-connection-button').getAttribute('aria-pressed'), 'true');
  await page.locator('#add-connection-button').click();
  await auditWorkspaceGeometry();
  await page.locator('#connection-name').fill('Switch draft');
  await page.locator('#connection-name').press('Escape'); await editor.waitFor({ state: 'hidden' });
  await auditWorkspaceGeometry();
  await page.locator('#drafts-button').click();
  assert.equal(await page.locator('#connection-name').inputValue(), 'Switch draft');
  await page.locator('#connection-name').press('Escape'); await editor.waitFor({ state: 'hidden' });
  await page.locator('#add-connection-button').click();
  assert.equal(await page.locator('#connection-name').inputValue(), '');
  await page.locator('#connection-name').press('Escape'); await editor.waitFor({ state: 'hidden' });
  await page.evaluate(async () => { fixture.drafts = []; await refreshDrafts(); document.querySelectorAll('.toast').forEach(el => el.remove()); });
  assert.equal(await page.locator('.connection-address, .connection-description, .module-strip, .card-actions [data-action="edit"]').count(), 0);
  assert.deepEqual(await page.locator('.connection-type').evaluateAll(elements => elements.map(el => el.dataset.itemType)), ['api', 'ssh', 'login']);
  assert.equal(await page.locator('.connection-type svg').count(), 3);
  assert.deepEqual(await page.locator('.connection-type').allTextContents(), ['', '', '']);
  assert.equal(await search.isVisible(), true, 'Workspace search is always available');
  assert.equal(await page.locator('.connection-card').count(), 3);
  await selectFilter('#item-type-switch', 'ssh');
  assert.deepEqual(await page.locator('.connection-card').evaluateAll(rows => rows.map(row => row.dataset.itemId)), ['beta']);
  await selectFilter('#item-type-switch', 'all');
  await page.locator('[data-item-type-filter="ssh"]').click();
  assert.deepEqual(await page.locator('.connection-card').evaluateAll(rows => rows.map(row => row.dataset.itemId)), ['beta']);
  await page.locator('[data-item-type-filter="login"]').click();
  assert.deepEqual(await page.locator('.connection-card').evaluateAll(rows => rows.map(row => row.dataset.itemId)), ['gamma']);
  await page.locator('[data-item-type-filter="api"]').click();
  assert.deepEqual(await page.locator('.connection-card').evaluateAll(rows => rows.map(row => row.dataset.itemId)), ['alpha']);
  await page.locator('[data-item-type-filter="api"]').press('Home');
  assert.equal(await page.locator('.connection-card').count(), 3);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.itemTypeFilter), 'all', 'Filter keyboard selection restores focus to the selected button');
  // All three pages share workspace search and independent labeled filter buttons.
  await page.locator('[data-page="activity"]').click();
  assert.equal(await search.getAttribute('data-page-search'), 'activity');
  assert.equal(await page.locator('#page-activity .page-search').count(), 0);
  await selectFilter('#activity-filter-switch', 'success');
  assert.match(await page.locator('.activity-title').innerText(), /success/);
  await selectFilter('#activity-filter-switch', 'all');
  await page.locator('[data-activity-filter="error"]').click();
  assert.equal(await page.locator('.activity-item').count(), 1);
  assert.match(await page.locator('.activity-title').innerText(), /failure/);
  await page.locator('[data-activity-filter="success"]').click();
  assert.match(await page.locator('.activity-title').innerText(), /success/);
  await page.locator('[data-activity-filter="all"]').click();
  await fillSearch('failure');
  assert.equal(await page.locator('.activity-item').count(), 1);
  await search.press('Escape');
  assert.equal(await page.locator('.activity-item').count(), 2);
  await auditWorkspaceGeometry();
  await page.screenshot({ path: path.join(artifacts, 'activity-filter-strip.png') });
  await page.locator('[data-page="settings"]').click();
  assert.equal(await search.getAttribute('data-page-search'), 'settings');
  assert.equal(await page.locator('#page-settings .page-search').count(), 0);
  await selectFilter('#settings-filter-switch', 'MCP');
  assert.equal(await page.locator('.settings-card:visible').count(), 1);
  await selectFilter('#settings-filter-switch', 'all');
  await page.locator('[data-settings-filter="MCP"]').click();
  assert.equal(await page.locator('.settings-card:visible').count(), 1);
  assert.equal(await page.locator('.settings-card:visible').getAttribute('data-module'), 'MCP / 02');
  await fillSearch('Agent');
  await page.locator('[data-page="activity"]').click();
  await page.locator('#title-search-toggle').click();
  assert.equal(await search.inputValue(), '');
  await page.locator('[data-page="settings"]').click();
  await page.locator('#title-search-toggle').click();
  assert.equal(await search.inputValue(), 'Agent');
  await search.press('Escape');
  await page.locator('[data-settings-filter="all"]').click();
  await page.screenshot({ path: path.join(artifacts, 'settings-filter-strip.png') });
  await page.locator('[data-page="connections"]').click();
  const order = () => page.locator('.connection-card').evaluateAll(rows => rows.map(row => row.dataset.itemId));
  await row('beta').locator('.connection-name').click();
  assert.equal(await row('beta').locator('.connection-name').getAttribute('aria-pressed'), 'true');
  assert.match(await page.locator('#workspace-detail').innerText(), /Synthetic server/);
  assert.equal(await editor.isHidden(), true, 'Selecting a name previews metadata instead of editing');
  assert.deepEqual(await page.evaluate(() => fixture.secretReads), [], 'Metadata selection must not retrieve plaintext');
  assert.equal(await page.locator('#workspace-detail input, #workspace-detail textarea, #workspace-detail [data-secret-value]').count(), 0);
  assert.equal(await page.evaluate(() => document.body.innerHTML.includes('synthetic-password')), false);
  await row('beta').locator('.connection-name').press('ArrowDown');
  assert.deepEqual(await order(), ['alpha', 'beta', 'gamma'], 'Names are not reorder handles');
  assert.equal(await page.evaluate(() => fixture.orderRequests), 0);
  const dragItem = async (from, target, after, release = true) => {
    const handle = row(from).locator('.workspace-reorder[data-item-reorder]');
    await handle.scrollIntoViewIfNeeded();
    const start = await handle.boundingBox(), end = await row(target).boundingBox();
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
    await page.mouse.down();
    await page.mouse.move(start.x + start.width / 2, after ? end.y + end.height - 1 : end.y + 1, { steps: 8 });
    if (release) await page.mouse.up();
  };
  await dragItem('alpha', 'gamma', true, false);
  assert.equal(await page.locator('.item-drag-preview').count(), 1);
  assert.equal(await page.locator('.item-drop-after').count(), 1);
  await page.screenshot({ path: path.join(artifacts, 'reorder-handle-feedback.png') });
  await page.mouse.up();
  await waitUntil(() => fixture.orders.length === 1 && !document.querySelector('#connections-list').hasAttribute('aria-busy'));
  assert.deepEqual(await order(), ['beta', 'gamma', 'alpha']);
  assert.deepEqual(await page.evaluate(() => fixture.orderAttempts[0]), { ids: ['beta', 'gamma', 'alpha'], expectedOrder: ['alpha', 'beta', 'gamma'] });
  assert.equal(await page.evaluate(() => document.activeElement.dataset.itemReorder), 'alpha', 'Sorting restores focus to its handle');
  await row('alpha').locator('.workspace-reorder[data-item-reorder]').press('Home');
  await waitUntil(() => fixture.orders.length === 2 && !document.querySelector('#connections-list').hasAttribute('aria-busy'));
  assert.deepEqual(await order(), ['alpha', 'beta', 'gamma']);
  await dragItem('alpha', 'gamma', true, false); await page.keyboard.press('Escape'); await page.mouse.up();
  assert.equal(await page.evaluate(() => fixture.orders.length), 2);
  assert.equal(await page.locator('.item-drag-preview').count(), 0);
  await page.evaluate(() => fixture.failOrder = true);
  await dragItem('alpha', 'gamma', true);
  await waitUntil(() => fixture.orderRequests === 3 && !document.querySelector('#connections-list').hasAttribute('aria-busy'));
  assert.deepEqual(await order(), ['alpha', 'beta', 'gamma'], 'A failed reorder must preserve the saved order');
  await page.evaluate(async () => {
    fixture.failOrder = false;
    fixture.state.connections.push({ ...structuredClone(fixture.state.connections[0]), id: 'delta', name: 'Second synthetic API' });
    await refresh();
  });
  await page.locator('[data-item-type-filter="api"]').click();
  await dragItem('delta', 'alpha', false);
  await waitUntil(() => fixture.orders.length === 3 && !document.querySelector('#connections-list').hasAttribute('aria-busy'));
  assert.deepEqual(await page.evaluate(() => fixture.state.connections.map(i => i.id)), ['delta', 'beta', 'gamma', 'alpha'], 'Filtered dragging preserves the hidden item slots');
  await page.locator('[data-item-type-filter="all"]').click();
  await page.evaluate(async () => {
    fixture.state.connections = ['alpha', 'beta', 'gamma'].map(id => fixture.state.connections.find(i => i.id === id));
    await refresh();
  });
  const beforeStaleOrder = await page.evaluate(() => ({ requests: fixture.orderRequests, saved: fixture.orders.length }));
  await page.evaluate(() => fixture.staleOrder = true);
  await row('alpha').locator('.workspace-reorder[data-item-reorder]').press('End');
  await waitUntil(requests => fixture.orderRequests === requests + 1 && !document.querySelector('#connections-list').hasAttribute('aria-busy'), beforeStaleOrder.requests);
  assert.deepEqual(await order(), ['alpha', 'gamma', 'beta'], 'A stale reorder must reload, not overwrite, the newer order');
  assert.equal(await page.evaluate(() => fixture.orders.length), beforeStaleOrder.saved);
  await page.evaluate(async () => {
    fixture.state.connections = ['alpha', 'beta', 'gamma'].map(id => fixture.state.connections.find(i => i.id === id));
    await refresh();
    document.querySelector('#connections-list').scrollTop = 0;
  });
  // The pointer can cross a long list without releasing the reorder handle.
  await page.evaluate(async () => {
    fixture.state.connections.push(...Array.from({ length: 20 }, (_, index) => ({ ...structuredClone(fixture.state.connections[0]), id: `scroll-${index}`, name: `Scroll item ${index}` })));
    await refresh();
  });
  const beforeScrollDrag = await page.evaluate(() => fixture.orderRequests);
  const scrollHandle = await row('alpha').locator('.workspace-reorder[data-item-reorder]').boundingBox();
  const scrollList = await page.locator('#connections-list').boundingBox();
  await page.mouse.move(scrollHandle.x + scrollHandle.width / 2, scrollHandle.y + scrollHandle.height / 2); await page.mouse.down();
  await page.mouse.move(scrollHandle.x + scrollHandle.width / 2, scrollList.y + scrollList.height - 5, { steps: 8 });
  await waitUntil(() => document.querySelector('#connections-list').scrollTop > 100);
  await page.mouse.move(scrollList.x - 5, scrollList.y + 50);
  assert.equal(await page.locator('.item-drop-before, .item-drop-after').count(), 0);
  await page.mouse.up();
  assert.equal(await page.evaluate(() => fixture.orderRequests), beforeScrollDrag, 'Dropping outside the list cancels the reorder');
  assert.equal(await page.locator('.item-drag-preview').count(), 0);
  await page.evaluate(async () => {
    fixture.state.connections = fixture.state.connections.filter(item => !item.id.startsWith('scroll-'));
    await refresh();
    document.querySelector('#connections-list').scrollTop = 0;
    document.querySelectorAll('.toast').forEach(el => el.remove());
  });
  await fillSearch('server');
  assert.equal(await page.locator('.connection-card').count(), 1);
  await auditWorkspaceGeometry();
  await page.screenshot({ path: path.join(artifacts, 'expanded-header-search.png') });
  await page.locator('#title-search-toggle').click();
  assert.equal(await search.isVisible(), true);
  assert.equal(await page.locator('.connection-card').count(), 1, 'Using the search button keeps its query');
  await page.keyboard.press('Control+f');
  assert.equal(await search.isVisible(), true);
  assert.equal(await search.evaluate(el => el === document.activeElement), true, 'Search shortcut focuses the input');
  await search.press('Escape');
  assert.equal(await search.isVisible(), true);
  assert.equal(await page.locator('.connection-card').count(), 3);
  await page.locator('[data-language="en"]').click();
  await toggle('alpha').click();
  await waitUntil(() => document.querySelector('#connection-modal').classList.contains('is-folding'));
  const opening = await editor.evaluate(el => {
    const animation = el.getAnimations()[0]; animation.pause(); animation.currentTime = 110;
    return { height: el.getBoundingClientRect().height, full: el.querySelector('.modal-card').getBoundingClientRect().height };
  });
  assert.ok(opening.height > 0 && opening.height < opening.full, 'The dropdown reveals its contents progressively');
  await editor.evaluate(el => el.getAnimations()[0].play());
  await waitUntil(() => document.activeElement.id === 'connection-name');
  const moduleSwitch = '#connection-modal [data-kind="password"] .module-agent-toggle';
  await dragSwitch(moduleSwitch, 0, 1);
  assert.equal(await page.locator(moduleSwitch).getAttribute('aria-pressed'), 'true');
  assert.equal(await editor.locator('[data-kind="password"] [data-module-visibility]').innerText(), 'AGENT VISIBLE');
  assert.equal(await editor.locator('[data-kind="password"] [data-module-agent-caption]').innerText(), 'AGENT VISIBLE');
  assert.equal(await page.evaluate(() => currentModules.find(module => module.kind === 'password').agentVisible), true);
  await dragSwitch(moduleSwitch, 1, 0);
  assert.equal(await page.locator(moduleSwitch).getAttribute('aria-pressed'), 'false');
  assert.equal(await editor.locator('[data-kind="password"] [data-module-visibility]').innerText(), 'AGENT HIDDEN');
  assert.equal(await editor.locator('[data-kind="password"] [data-module-agent-caption]').innerText(), 'AGENT HIDDEN');
  await page.locator(moduleSwitch).press('Space');
  assert.equal(await editor.locator('[data-kind="password"] [data-module-visibility]').innerText(), 'AGENT VISIBLE');
  await page.locator(moduleSwitch).press('Enter');
  assert.equal(await editor.locator('[data-kind="password"] [data-module-visibility]').innerText(), 'AGENT HIDDEN');
  await auditWorkspaceStates();
  await auditWorkspaceGeometry();
  assert.deepEqual(await editor.locator('.modal-card, .module-row, .module-actions, .module-add-wrap, .login-websites').evaluateAll(els => els.map(el => getComputedStyle(el).boxShadow)), Array(await editor.locator('.modal-card, .module-row, .module-actions, .module-add-wrap, .login-websites').count()).fill('none'), 'Expanded groups do not nest recessed trays');
  await toggle('alpha').click();
  await waitUntil(() => document.querySelector('#connection-modal').classList.contains('is-folding'));
  const closing = await editor.evaluate(el => { const animation = el.getAnimations()[0]; animation.pause(); animation.currentTime = 110; return el.getBoundingClientRect().height; });
  assert.ok(closing > 0 && closing < opening.full, 'Collapsing animates before detaching the editor');
  await editor.evaluate(el => el.getAnimations()[0].play()); await editor.waitFor({ state: 'hidden' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await toggle('alpha').click(); await waitUntil(() => document.activeElement.id === 'connection-name');
  assert.equal(await editor.evaluate(el => el.getAnimations().length), 0);
  await toggle('alpha').click(); await editor.waitFor({ state: 'hidden' });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await toggle('alpha').click();
  await waitUntil(() => document.activeElement.id === 'connection-name');
  assert.equal(await editor.getAttribute('role'), 'region');
  assert.equal(await editor.getAttribute('aria-modal'), null);
  assert.equal(await editor.evaluate(el => el.parentElement.dataset.itemId), 'alpha');
  await requireVisible(['#connection-modal .modal-header', '#connection-modal .modal-header [data-close-modal]']);
  assert.equal(await page.locator('.modal-backdrop:not(.inline-editor):not(.hidden)').count(), 0);
  await page.locator('#connection-name').fill('Edited synthetic service');
  await page.locator('#connection-description').fill('Keep this unsaved value');
  await row('alpha').locator('.workspace-reorder[data-item-reorder]').press('ArrowDown');
  await waitUntil(() => !document.querySelector('#connections-list').hasAttribute('aria-busy'));
  assert.deepEqual(await order(), ['beta', 'alpha', 'gamma']);
  assert.equal(await page.locator('#connection-description').inputValue(), 'Keep this unsaved value');
  await row('alpha').locator('.workspace-reorder[data-item-reorder]').press('Home');
  await waitUntil(() => !document.querySelector('#connections-list').hasAttribute('aria-busy'));
  await page.evaluate(async () => { fixture.state.connections[1].name = 'Refreshed server'; await refresh(); });
  assert.equal(await page.locator('#connection-name').inputValue(), 'Edited synthetic service');
  await page.locator('[data-language="zh"]').click();
  assert.equal(await page.locator('#connection-description').inputValue(), 'Keep this unsaved value');
  await fillSearch('no matching service');
  assert.equal(await page.locator('.connection-card').count(), 1, 'Keep the edited row while filtering');
  await fillSearch('');
  await toggle('alpha').click(); await editor.waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => fixture.drafts[0].input.name), 'Edited synthetic service');
  await toggle('alpha').click();
  assert.equal(await page.locator('#connection-name').inputValue(), 'Edited synthetic service');
  await page.locator('#connection-folder').fill('Unsaved folder');
  const itemSwitch = '.switch:has(#connection-enabled)';
  await dragSwitch(itemSwitch, 1, 0);
  assert.equal(await page.locator('#connection-enabled').isChecked(), false);
  await page.locator('#connection-enabled').press('Space');
  assert.equal(await page.locator('#connection-enabled').isChecked(), true);
  await page.locator('#connection-enabled-label').click();
  assert.equal(await page.locator('#connection-enabled').isChecked(), false);
  await toggle('beta').click();
  await waitUntil(() => document.querySelector('#connection-modal').parentElement.dataset.itemId === 'beta' && !document.querySelector('#connection-modal').classList.contains('is-folding'));
  assert.equal(await editor.evaluate(el => el.parentElement.dataset.itemId), 'beta');
  assert.equal(await toggle('alpha').getAttribute('aria-expanded'), 'false');
  assert.equal(await page.evaluate(() => fixture.drafts.find(d => d.input.id === 'alpha').input.folder), 'Unsaved folder');
  assert.equal(await page.evaluate(() => fixture.drafts.find(d => d.input.id === 'alpha').input.enabled), false);
  await toggle('alpha').click();
  await waitUntil(() => document.activeElement.id === 'connection-name');
  assert.equal(await page.locator('#connection-enabled').isChecked(), false, 'Restoring a draft retains the item switch');
  await page.locator('#save-connection-button').focus(); await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.closest('.connection-card')?.dataset.itemId), 'beta', `Inline editor must not trap Tab: ${await page.evaluate(() => document.activeElement.outerHTML)}`);
  await page.locator('[data-generate-password]').click();
  await waitUntil(() => document.querySelector('#generator-result').value.length === 24);
  await page.locator('#generator-use').click();
  assert.equal((await page.locator('[data-kind="password"] [data-secret-value]').inputValue()).length, 24);
  await page.locator('#add-module-button').click(); await page.keyboard.press('Escape');
  assert.equal(await page.locator('#module-menu').isHidden(), true);
  assert.equal(await editor.isVisible(), true);
  await page.locator('#add-module-button').click(); await page.locator('[data-add-module="username"]').click();
  assert.equal(await page.locator('[data-kind="username"]').count(), 1);
  for (const theme of ['dark', 'light']) {
    if (await page.locator('html').getAttribute('data-theme') !== theme) await page.locator('#theme-toggle').click();
    await page.waitForTimeout(180);
    await auditWorkspaceStates();
    for (const width of [390, 460, 760, 1200]) {
      await display.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1.5, mobile: false });
      await auditWorkspaceGeometry();
      await requireVisible(['#connection-modal .modal-header [data-close-modal]', '#connection-name', '#add-module-button', '#save-connection-button']);
    }
    await page.locator(moduleSwitch).evaluate(el => { el.disabled = true; });
    try {
      await auditWorkspaceStates();
      const before = await page.locator(moduleSwitch).getAttribute('aria-pressed');
      await page.locator(moduleSwitch).scrollIntoViewIfNeeded();
      const box = await page.locator(moduleSwitch).boundingBox();
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      assert.equal(await page.locator(moduleSwitch).getAttribute('aria-pressed'), before, 'Disabled permissions must not change on pointer input');
      assert.equal(await page.evaluate(() => currentModules.find(module => module.kind === 'password').agentVisible), false);
    }
    finally { await page.locator(moduleSwitch).evaluate(el => { el.disabled = false; }); }
    await page.evaluate(() => document.querySelectorAll('.toast').forEach(el => el.remove()));
    await page.locator('#connections-list').evaluate(el => el.scrollTop = 0);
    await page.mouse.move(0, 0); await page.screenshot({ path: path.join(artifacts, `inline-${theme}.png`) });
    assert.equal(await editor.evaluate(el => el.scrollWidth > el.clientWidth), false);
  }
  await page.locator('#save-connection-button').click(); await editor.waitFor({ state: 'hidden' });
  assert.equal((await row('alpha').locator('.workspace-row-name').innerText()).replace(/\s*★$/, ''), 'Edited synthetic service');
  assert.equal(await page.evaluate(() => fixture.drafts.some(d => d.input.id === 'alpha')), false);
  assert.equal(await page.evaluate(() => fixture.saved[0].secrets.password.length), 24);
  assert.equal(await page.evaluate(() => fixture.saved[0].enabled), false);
  assert.equal(await page.evaluate(() => fixture.saved[0].modules.find(module => module.kind === 'password').agentVisible), false, 'Owner edits must not silently expose the password to agents');
  assert.equal(await page.evaluate(() => fixture.saved[0].favorite), true, 'Removing the editor control must preserve existing favorite metadata');
  await toggle('alpha').click();
  await page.locator('#connection-name').fill('Unsaved stale edit');
  const beforeStaleEdit = await page.evaluate(() => fixture.saved.length);
  await page.evaluate(async () => {
    const item = fixture.state.connections.find(item => item.id === 'alpha');
    item.name = 'Newer external edit'; item.updatedAt = 'external-revision';
    await refresh();
  });
  await page.locator('#save-connection-button').click();
  await waitUntil(() => [...document.querySelectorAll('.toast')].some(toast => toast.textContent.includes('Stale edit')));
  assert.equal(await editor.isVisible(), true, 'Rejecting stale edits must retain the active form');
  assert.equal(await page.locator('#connection-name').inputValue(), 'Unsaved stale edit');
  assert.equal(await page.evaluate(() => fixture.saved.length), beforeStaleEdit);
  assert.equal(await page.evaluate(() => fixture.state.connections.find(item => item.id === 'alpha').name), 'Newer external edit');
  assert.equal(await page.evaluate(() => fixture.saveRequests.at(-1).expectedUpdatedAt), 'revision-2', 'Save must retain the editor opening revision after refresh');
  await editor.locator('.modal-header [data-close-modal]').click();
  await editor.waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => fixture.drafts.find(draft => draft.input.id === 'alpha').input.name), 'Unsaved stale edit');
  await toggle('alpha').click(); await page.locator('#connection-name').fill('Draft across navigation');
  await page.evaluate(() => fixture.failDraft = true);
  await toggle('beta').click();
  assert.equal(await editor.evaluate(el => el.parentElement.dataset.itemId), 'alpha', 'A failed draft write must retain the active form');
  assert.equal(await page.locator('#connection-name').inputValue(), 'Draft across navigation');
  await selectFilter('#item-type-switch', 'ssh', 'all');
  assert.equal(await editor.evaluate(el => el.parentElement.dataset.itemId), 'alpha', 'A failed draft save restores the selected filter and retains the form');
  await page.evaluate(() => fixture.failDraft = false);
  await selectFilter('#item-type-switch', 'ssh');
  await editor.waitFor({ state: 'hidden' });
  assert.deepEqual(await order(), ['beta']);
  assert.equal(await page.evaluate(() => fixture.drafts.find(d => d.input.id === 'alpha').input.name), 'Draft across navigation');
  await selectFilter('#item-type-switch', 'all');
  await toggle('alpha').click(); await waitUntil(() => document.activeElement.id === 'connection-name');
  await page.locator('[data-page="settings"]').click(); await editor.waitFor({ state: 'hidden' });
  await page.locator('[data-page="connections"]').click(); await toggle('alpha').click();
  assert.equal(await page.locator('#connection-name').inputValue(), 'Draft across navigation');
  await page.locator('#connection-name').press('Escape'); await editor.waitFor({ state: 'hidden' });
  await toggle('alpha').click();
  await waitUntil(() => !document.querySelector('#connection-modal').classList.contains('is-folding'));
  await page.locator('#connections-list').evaluate(el => { el.scrollTop = 0; });
  const deleteButton = row('alpha').locator('[data-action="delete"]');
  await row('alpha').locator('.workspace-more').click();
  await deleteButton.scrollIntoViewIfNeeded();
  const deleteHit = await deleteButton.evaluate(el => {
    const box = el.getBoundingClientRect();
    const target = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return { receivesPointer: el === target || el.contains(target), target: target?.outerHTML, width: innerWidth,
      language: document.documentElement.lang, theme: document.documentElement.dataset.theme,
      button: { x: box.x, y: box.y, width: box.width, height: box.height } };
  });
  if (!deleteHit.receivesPointer) {
    visualFailures.push({ check: 'expanded-row delete button must receive pointer input', ...deleteHit });
    await page.screenshot({ path: path.join(artifacts, 'expanded-row-pointer-failure.png') });
  }
  // Test confirmation independently even if a layout regression blocks the pointer.
  await deleteButton.press('Enter');
  await waitUntil(() => document.activeElement.id === 'confirmation-cancel');
  assert.deepEqual(await page.evaluate(() => fixture.deleted), [], 'Deletion requires explicit confirmation');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'confirmation-accept', 'Confirmation traps reverse Tab');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'confirmation-cancel', 'Confirmation traps forward Tab');
  await page.keyboard.press('Escape');
  await page.locator('#confirmation-modal').waitFor({ state: 'hidden' });
  assert.equal(await editor.isVisible(), true, 'Canceling deletion retains the active editor');
  assert.deepEqual(await page.evaluate(() => fixture.deleted), []);
  await row('alpha').locator('.workspace-more').click();
  await deleteButton.press('Enter'); await page.locator('#confirmation-accept').click();
  await row('alpha').waitFor({ state: 'detached' });
  assert.deepEqual(await page.evaluate(() => fixture.deleted), [{ id: 'alpha', expectedUpdatedAt: 'external-revision' }]);
  assert.equal(await editor.count(), 1, 'Removing an expanded row must preserve the editor DOM');
  assert.equal(await editor.isHidden(), true);
  await page.locator('#add-connection-button').click();
  assert.equal(await editor.getAttribute('role'), 'dialog');
  await page.locator('[data-item-template="login"]').click(); await page.locator('[data-generate-password]').click();
  await page.locator('#generator-use').click();
  assert.equal(await page.locator('#generator-modal').isHidden(), true, 'Nested dialogs must stay above the restored new-item editor');
  assert.deepEqual(errors, []);
  functionalChecksPassed = true;
  console.log('Inline editor functional regressions passed; checking accumulated accessibility/layout failures.');
  assert.deepEqual(visualFailures, [], 'Workspace accessibility checks must pass (see visual-failures.json)');
  console.log(JSON.stringify({ ok: true, checks: ['responsive workspace bounds at 390/460/760/1200px and four display scales in both languages/themes', 'labeled navigation and filter buttons with keyboard selection', 'theme and language drag plus appearance persistence', 'binary settings/module state captions, contrast and disabled states', 'integration switches commit once and recover from failures', 'PIN confirmation and cancellation', 'inline expansion, collapse and reduced motion', 'draft restoration and failed-write recovery across filters/navigation', 'pointer and keyboard reordering with filtered slots', 'reorder cancellation, edge scrolling and save failure', 'refresh and search preserve edits', 'untrapped keyboard focus with visible editor header', 'generator and module menu', 'save payloads and deletion confirmation', 'new-item dialog restoration'], artifacts }, null, 2));
} catch (error) {
  await page?.screenshot({ path: path.join(artifacts, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  await fs.writeFile(path.join(artifacts, 'control-geometry.json'), JSON.stringify(geometryMeasurements, null, 2));
  await fs.writeFile(path.join(artifacts, 'control-states.json'), JSON.stringify(stateMeasurements, null, 2));
  await fs.writeFile(path.join(artifacts, 'visual-failures.json'), JSON.stringify(visualFailures, null, 2));
  await fs.writeFile(path.join(artifacts, 'result.json'), JSON.stringify({ ok: functionalChecksPassed && visualFailures.length === 0, functionalChecksPassed, visualFailures: visualFailures.length }, null, 2));
  await browser.close(); server.close();
}
