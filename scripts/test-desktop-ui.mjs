// Run: PLAYWRIGHT_CHANNEL=chrome node scripts/test-desktop-ui.mjs
// DESKTOP_RENDERER_DIR (or WORKSPACE_RENDERER_DIR) pins a pre-change snapshot.
// Synthetic browser boundary only: no native app, real vault, or external service.
// Reference: /Applications/magpie.app (com.yetone.magpie), yetone's Agent manager.
// This is not Blinue/Magpie's Windows/WinUI design contract.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createWorkspaceFixture, installWorkspaceFixture } from './fixtures/workspace.mjs';

const source = path.resolve(process.env.DESKTOP_RENDERER_DIR || process.env.WORKSPACE_RENDERER_DIR || path.join(import.meta.dirname, '../renderer'));
const artifacts = await fs.mkdtemp(path.join(os.tmpdir(), 'openkeylet-desktop-ui-'));
const renderer = path.join(artifacts, 'renderer-snapshot');
const capturedAt = new Date().toISOString();
await fs.cp(source, renderer, { recursive: true });
const fingerprints = {};
async function fingerprint(directory, prefix = '') {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) await fingerprint(path.join(directory, entry.name), relative);
    else if (entry.isFile()) fingerprints[relative] = createHash('sha256').update(await fs.readFile(path.join(directory, entry.name))).digest('hex');
  }
}
await fingerprint(renderer);
await fs.writeFile(path.join(artifacts, 'snapshot.json'), `${JSON.stringify({ source, capturedAt, fingerprints }, null, 2)}\n`);

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const file = path.resolve(renderer, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!file.startsWith(`${renderer}${path.sep}`)) { response.writeHead(403); response.end(); return; }
    const body = await fs.readFile(file);
    response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(body);
  } catch { response.writeHead(404); response.end(); }
});

async function settle(page, predicate, argument, message = 'Renderer state did not settle') {
  // Poll outside the page: waitForFunction's eval would weaken the renderer CSP.
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (await page.evaluate(predicate, argument)) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.fail(message);
}

async function measure(page, selector, pseudo = null) {
  return page.locator(selector).evaluate((element, pseudo) => {
    const style = getComputedStyle(element, pseudo);
    const box = element.getBoundingClientRect();
    return {
      x: box.x, y: box.y, width: box.width, height: box.height, bottom: box.bottom, right: box.right,
      display: style.display, visibility: style.visibility, fontSize: parseFloat(style.fontSize), fontFamily: style.fontFamily,
      background: style.backgroundColor, color: style.color, content: style.content,
      backgroundImage: style.backgroundImage, shadow: style.boxShadow, opacity: Number(style.opacity),
      cssWidth: parseFloat(style.width), cssHeight: parseFloat(style.height),
      padding: ['Top', 'Right', 'Bottom', 'Left'].map(side => parseFloat(style[`padding${side}`])),
      radius: parseFloat(style.borderTopLeftRadius),
      radii: ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'].map(corner => parseFloat(style[`border${corner}Radius`])),
      borders: ['Top', 'Right', 'Bottom', 'Left'].map(side => parseFloat(style[`border${side}Width`])),
    };
  }, pseudo);
}

function sans(fontFamily, label) {
  const families = fontFamily.toLowerCase().split(',').map(family => family.trim().replaceAll(/['"]/g, ''));
  assert.ok(!families.some(family => ['serif', 'charter', 'bitstream charter', 'georgia', 'times', 'times new roman'].includes(family)), `${label} must use sans typography, got ${fontFamily}`);
}

function rgb(color) {
  const components = color.match(/[\d.]+/g)?.map(Number);
  assert.ok(components?.length >= 3, `Expected a computed RGB color, got ${color}`);
  return components.slice(0, 3).map(value => color.startsWith('color(srgb ') ? value * 255 : value);
}

function neutral(color, label) {
  const channels = rgb(color);
  assert.ok(Math.max(...channels) - Math.min(...channels) <= 20, `${label} must be a neutral grey surface, got ${color}`);
}

function rounded(box, minimum, maximum, label) {
  assert.ok(box.radii.every(radius => radius >= minimum && radius <= maximum), `${label} corners must be ${minimum}-${maximum}px, got ${box.radii.join(', ')}px`);
}

function primaryButton(box, theme, label) {
  neutral(box.background, label);
  const alpha = box.background.match(/[\d.]+/g)?.map(Number)[3] ?? 1;
  assert.ok(alpha >= 0.9 && box.backgroundImage === 'none', `${label} must use a solid neutral fill`);
  if (theme === 'light') assert.ok(Math.max(...rgb(box.background)) <= 90, `${label} must use muted charcoal, not a bright accent: ${box.background}`);
  rounded(box, 6, 10, label);
}

async function noOverflow(page) {
  return page.evaluate(() => {
    const issues = [];
    if (document.documentElement.scrollWidth > innerWidth + 1) issues.push(`Document width ${document.documentElement.scrollWidth} > ${innerWidth}`);
    for (const element of document.querySelectorAll('.title-drag-region, .title-tools, .window-controls, .workspace-sidebar, .nav, .workspace-breadcrumb, .workspace-toolbar, .workspace-summary, .workspace-list-panel, #workspace-detail, #page-settings .page-header, .settings-card')) {
      if (!element.checkVisibility()) continue;
      const box = element.getBoundingClientRect(), style = getComputedStyle(element);
      if (box.left < -1 || box.right > innerWidth + 1) issues.push(`${element.id || element.className}: outside viewport`);
      if (element.scrollWidth > element.clientWidth + 1 && !['auto', 'scroll'].includes(style.overflowX)) issues.push(`${element.id || element.className}: horizontal content clipped`);
    }
    return issues;
  });
}

async function assertMetadataOnly(page) {
  const audit = await page.evaluate(() => {
    const html = document.body.innerHTML;
    const inputs = [...document.querySelectorAll('input, textarea')].map(element => element.value);
    return {
      reads: workspaceFixture.calls.filter(call => /owner_secret_view|plaintext|private_value|password_history|copy_owner/.test(call.command)),
      leaks: Object.values(workspaceFixture.privateById).flatMap(item => Object.values(item)).filter(value => value && (html.includes(value) || inputs.some(input => input.includes(value)))),
    };
  });
  assert.deepEqual(audit.reads, [], 'Shell, filters and metadata selection must never request private values');
  assert.deepEqual(audit.leaks, [], 'Synthetic private values must not enter DOM or form controls');
}

async function statusMetrics(page) {
  return page.locator('.workspace-summary .workspace-metric').evaluateAll(elements => elements.map(element => ({
    label: element.querySelector('.workspace-metric-label')?.textContent.trim(),
    value: element.querySelector('strong')?.textContent.trim(),
    hint: element.querySelector('small')?.textContent.trim(),
    accessibleText: [element.textContent, element.getAttribute('aria-label'), element.getAttribute('title')].filter(Boolean).join(' '),
  })));
}

function installDesktopAgentProbe() {
  const invoke = window.__TAURI__.core.invoke;
  workspaceFixture.desktopAgents = [];
  window.__TAURI__.core.invoke = async (command, args = {}) => {
    if (command !== 'agent_mcp_status') return invoke(command, args);
    workspaceFixture.calls.push({ command, args: structuredClone(args) });
    return structuredClone(workspaceFixture.desktopAgents);
  };
}

function installDesktopPlatform(platform) {
  const macOS = platform === 'macos';
  const userAgent = navigator.userAgent.replace(/\([^)]*\)/, macOS ? '(Macintosh; Intel Mac OS X 10_15_7)' : '(Windows NT 10.0; Win64; x64)');
  Object.defineProperty(navigator, 'platform', { get: () => macOS ? 'MacIntel' : 'Win32' });
  Object.defineProperty(navigator, 'userAgent', { get: () => userAgent });
}

async function installDesktopFixture(page, { language, theme, platform, empty = false }) {
  // One script preserves probe ordering before app.js captures invoke.
  await page.addInitScript({ content: `(${installDesktopPlatform.toString()})(${JSON.stringify(platform)});\n(${installWorkspaceFixture.toString()})(${JSON.stringify(createWorkspaceFixture({ language, theme, empty }))});\n(${installDesktopAgentProbe.toString()})();` });
}

async function accessibleControl(page, selector, { topBar = false } = {}) {
  const control = page.locator(selector);
  assert.equal(await control.isVisible(), true, `${selector} must be visible`);
  if (!topBar) await control.scrollIntoViewIfNeeded();
  const result = await control.evaluate(element => {
    const box = element.getBoundingClientRect();
    const name = element.getAttribute('aria-label') || element.getAttribute('title') || [...(element.labels || [])].map(label => label.innerText).join(' ') || element.innerText;
    const center = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return { name: name?.trim(), hit: center === element || element.contains(center), x: box.x, right: box.right, y: box.y, bottom: box.bottom, width: box.width, height: box.height, tabIndex: element.tabIndex };
  });
  assert.ok(result.name, `${selector} must have a meaningful accessible name`);
  assert.ok(result.tabIndex >= 0, `${selector} must remain keyboard accessible`);
  assert.ok(result.hit, `${selector} must not be clipped or covered`);
  const viewport = page.viewportSize();
  assert.ok(result.x >= -1 && result.right <= viewport.width + 1 && result.y >= -1 && result.bottom <= viewport.height + 1, `${selector} must fit in the viewport`);
  return result;
}

const results = [];
let browser;
try {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}), args: ['--disable-background-networking', '--disable-component-update', '--no-first-run'] });
  const scenarios = [];
  for (const viewport of [{ width: 1200, height: 800 }, { width: 1920, height: 1080 }, { width: 760, height: 600 }, { width: 390, height: 844 }]) {
    for (const language of ['en', 'zh']) for (const theme of ['light', 'dark']) scenarios.push({ viewport, language, theme, platform: 'macos' });
  }
  for (const viewport of [{ width: 1200, height: 800 }, { width: 760, height: 600 }, { width: 390, height: 844 }]) scenarios.push({ viewport, language: 'en', theme: 'light', platform: 'windows' });
  for (const { viewport, language, theme, platform } of scenarios) {
      const scenario = `${platform}-${language}-${theme}-${viewport.width}x${viewport.height}`;
      const context = await browser.newContext({ viewport, serviceWorkers: 'block', reducedMotion: 'reduce' });
      const page = await context.newPage();
      page.setDefaultTimeout(3000);
      page.setDefaultNavigationTimeout(10000);
      const pageErrors = [], blockedNetwork = [];
      page.on('pageerror', error => pageErrors.push(error.message));
      await context.route('**/*', route => {
        if (new URL(route.request().url()).origin === origin) return route.continue();
        blockedNetwork.push(route.request().url());
        return route.abort('blockedbyclient');
      });
      await context.routeWebSocket('**/*', socket => { blockedNetwork.push(socket.url()); socket.close(); });
      await installDesktopFixture(page, { language, theme, platform });
      const check = async (name, run) => {
        const result = { scenario, name, ok: false };
        try { result.measurements = await run(); result.ok = true; }
        catch (error) { result.error = error.message; result.stack = error.stack; }
        results.push(result);
        console.log(`${result.ok ? 'PASS' : 'FAIL'} ${scenario}: ${name}${result.error ? `\n  ${result.error.split('\n')[0]}` : ''}`);
      };
      const screenshot = async (name, target = page) => {
        const filename = `${scenario}-${name}.png`;
        await target.screenshot({ path: path.join(artifacts, filename), animations: 'disabled' });
        return { screenshot: filename };
      };
      try {
        await page.goto(origin);
        await settle(page, () => document.querySelectorAll('#connections-list .connection-card').length === 6 && workspaceFixture.calls.some(call => call.command === 'agent_mcp_status') && document.querySelector('.workspace-summary .workspace-metric strong'), null, 'Synthetic renderer must finish bootstrapping');
        await check('initial shell screenshot', () => screenshot('vault'));
        await check('initial geometry evidence', async () => ({
          titlebar: await measure(page, '.title-drag-region'), heading: await measure(page, '#workspace-heading'),
          statusStrip: await measure(page, '.workspace-summary'), list: await measure(page, '.workspace-list-panel'),
          activeNavigation: await measure(page, '.nav .nav-item.active'), activeRail: await measure(page, '.nav .nav-item.active', '::before'),
          metrics: await statusMetrics(page), overflow: await noOverflow(page),
        }));
        await check('localized shell and theme', async () => {
          assert.equal(await page.locator('html').getAttribute('lang'), language === 'zh' ? 'zh-CN' : 'en');
          assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
          assert.equal(await page.locator('html').evaluate(element => element.classList.contains('platform-macos')), platform === 'macos', 'Platform-specific chrome must be exercised deterministically');
          const heading = await page.locator('#workspace-heading').innerText();
          assert.ok(heading.trim());
          assert.equal(/[\u3400-\u9fff]/u.test(heading), language === 'zh');
        });
        await check('compact native titlebar', async () => {
          const box = await measure(page, '.title-drag-region');
          assert.ok(box.height >= 32 && box.height <= 44, `App titlebar must be approximately 40px (32-44px), got ${box.height}px`);
          assert.ok(box.y >= -1 && box.bottom <= 44, 'Native titlebar must occupy the top of the window');
          return box;
        });
        await check('compact accessible native controls', async () => {
          const controls = [];
          for (const action of ['minimize', 'maximize', 'close']) {
            const box = await accessibleControl(page, `[data-window-action="${action}"]`, { topBar: true });
            if (platform === 'macos') {
              assert.ok(box.width >= 20 && box.width <= 28 && box.height >= 28 && box.height <= 36, `${action} must retain a larger accessible traffic-light hit target, got ${box.width}x${box.height}`);
              const disk = await measure(page, `[data-window-action="${action}"]`, '::before');
              assert.ok(disk.display !== 'none' && disk.visibility !== 'hidden' && disk.opacity > 0 && !['none', 'normal'].includes(disk.content), `${action} must paint its traffic-light disk`);
              assert.ok(Math.abs(disk.cssWidth - 11) <= 1 && Math.abs(disk.cssHeight - 11) <= 1, `${action} visual disk must be approximately 11x11px, got ${disk.cssWidth}x${disk.cssHeight}`);
              assert.ok(disk.radii.every(radius => radius >= disk.cssWidth / 2), `${action} visual disk must be circular`);
            } else assert.ok(box.width >= 20 && box.width <= 50 && box.height >= 20 && box.height <= 40, `${action} must retain a compact Windows window button`);
            controls.push({ action, ...box });
          }
          for (const selector of ['#theme-toggle', '#sound-toggle', '#owner-lock-button', '[data-language="en"]', '[data-language="zh"]']) await accessibleControl(page, selector, { topBar: true });
          return controls;
        });
        await check('platform window placement and CSS traffic-light order', async () => {
          const selectors = ['close', 'minimize', 'maximize'];
          const controls = Object.fromEntries(await Promise.all(selectors.map(async action => [action, await measure(page, `[data-window-action="${action}"]`)])));
          const group = await measure(page, '.window-controls');
          const domOrder = await page.locator('[data-window-action]').evaluateAll(elements => elements.map(element => element.dataset.windowAction));
          assert.deepEqual(domOrder, ['minimize', 'maximize', 'close'], 'Retain existing button wiring/DOM order; use CSS for platform placement');
          if (platform === 'macos') {
            assert.ok(group.x >= 4 && group.right <= 100, `macOS traffic lights belong at the left edge, got x${group.x}-${group.right}`);
            assert.ok(controls.close.right <= controls.minimize.x && controls.minimize.right <= controls.maximize.x, 'macOS visual order must be close, minimize, maximize');
            const mark = await measure(page, '.app-mark');
            assert.ok(group.right <= mark.x, 'Traffic lights must precede the app mark visually');
            const [closeRed, closeGreen, closeBlue] = rgb((await measure(page, '[data-window-action="close"]', '::before')).background);
            const [minRed, minGreen, minBlue] = rgb((await measure(page, '[data-window-action="minimize"]', '::before')).background);
            const [maxRed, maxGreen, maxBlue] = rgb((await measure(page, '[data-window-action="maximize"]', '::before')).background);
            assert.ok(closeRed > closeGreen + 40 && closeRed > closeBlue + 40, 'Close must use a red traffic light');
            assert.ok(minRed > minBlue + 40 && minGreen > minBlue + 40, 'Minimize must use an amber traffic light');
            assert.ok(maxGreen > maxRed + 15 && maxGreen > maxBlue + 15, 'Maximize must use a green traffic light');
          } else {
            assert.ok(group.right <= viewport.width + 1 && group.right >= viewport.width - 16 && group.x > viewport.width / 2, 'Windows controls remain right aligned');
            assert.ok(controls.minimize.right <= controls.maximize.x && controls.maximize.right <= controls.close.x, 'Windows visual order remains minimize, maximize, close');
          }
          return { group, controls, domOrder };
        });
        await check('practical sans workspace heading at most 26px', async () => {
          const heading = await measure(page, '#workspace-heading');
          assert.ok(heading.fontSize >= 18 && heading.fontSize <= 26, `Practical workspace heading must be 18-26px, got ${heading.fontSize}px`);
          sans(heading.fontFamily, 'Workspace heading');
          return heading;
        });
        await check('compact breadcrumb in the main header', async () => {
          const breadcrumb = page.locator('.workspace-breadcrumb');
          assert.equal(await breadcrumb.count(), 1, 'Main header must expose one workspace breadcrumb');
          assert.equal(await breadcrumb.isVisible(), true, 'Breadcrumb must be visible, not hidden placeholder markup');
          assert.ok((await breadcrumb.innerText()).trim(), 'Breadcrumb must identify the current workspace/page');
          assert.equal(await breadcrumb.evaluate(element => element.closest('.main-content')?.firstElementChild === element), true, 'Breadcrumb must lead the main content, not live in the native titlebar');
          const box = await measure(page, '.workspace-breadcrumb');
          assert.ok(box.fontSize >= 10 && box.fontSize <= 14 && box.height <= 38, 'Breadcrumb remains a compact secondary header');
          return box;
        });
        await check('no visible marketing or dashboard framing', async () => {
          const marketing = await page.locator('.workspace-eyebrow, .workspace-local-badge, [data-workspace-copy="eyebrow"], [data-workspace-copy="device"]').evaluateAll(elements => elements.filter(element => element.checkVisibility()).map(element => element.textContent.trim()));
          assert.deepEqual(marketing, [], 'Marketing eyebrow, local badge and promotional sidebar copy must not be visible');
          const visibleText = await page.locator('body').innerText();
          assert.doesNotMatch(visibleText, /YOUR KEYS\. YOUR CONTROL\.|One place for your keys\. Ready for your agents\.|Bring your tools to the vault\.|Local-first workspace|\u4f60\u7684\u5bc6\u94a5\uff0c\u7531\u4f60\u638c\u63a7|\u8ba9\u5de5\u5177\u8fde\u63a5\u4f60\u7684\u5bc6\u94a5\u5e93|\u672c\u5730\u4f18\u5148\u5de5\u4f5c\u7a7a\u95f4/u);
          assert.equal(await page.locator('.metric-grid:not(.workspace-summary):visible').count(), 0, 'No separate large metrics dashboard');
        });
        await check('inline bottom status strip at most 38px', async () => {
          const strip = await measure(page, '.workspace-summary');
          assert.ok(strip.height > 0 && strip.height <= 38, `Real inline status strip must be <=38px, got ${strip.height}px`);
          assert.equal(await page.locator('.workspace-summary').getAttribute('role'), 'status', 'Status strip must expose status semantics');
          assert.ok((await page.locator('.workspace-summary').getAttribute('aria-label'))?.trim(), 'Status strip must have an accessible label');
          const placement = await page.locator('.workspace-summary').evaluate(element => {
            const main = element.closest('.main-content');
            const children = [...main.children].filter(child => child.checkVisibility());
            const last = children.at(-1);
            const active = main.querySelector('.page.active');
            return { last: last === element || last.contains(element), afterPage: Boolean(active.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING), bottom: main.getBoundingClientRect().bottom, pageBottom: active.getBoundingClientRect().bottom };
          });
          assert.ok(placement.last && placement.afterPage, 'Status strip belongs after the page, at the bottom of main-content');
          if (viewport.width >= 760) {
            assert.ok(strip.y >= placement.pageBottom - 1, 'Desktop status strip must visually follow the page, not be CSS-reordered into a dashboard');
            assert.ok(strip.bottom <= viewport.height + 1 && placement.bottom - strip.bottom >= -1 && placement.bottom - strip.bottom <= 24, 'Desktop status strip must anchor to the bottom of main-content');
          }
          assert.equal(await page.locator('.workspace-summary .workspace-metric').count(), 4, 'Status strip retains four real counters/states');
          for (const value of await page.locator('.workspace-summary .workspace-metric strong').all()) {
            assert.equal(await value.isVisible(), true, 'All four inline status values must remain visible');
            const size = await value.evaluate(element => parseFloat(getComputedStyle(element).fontSize));
            assert.ok(size > 0 && size <= 16, `Inline status values must not be dashboard-sized: ${size}px`);
          }
          return { strip, placement, metrics: await statusMetrics(page) };
        });
        await check('four live counters and states are not decoration', async () => {
          const metrics = await statusMetrics(page);
          assert.equal(metrics.length, 4);
          assert.ok(metrics.every(metric => metric.label && metric.value), 'Each status needs a label and real value');
          assert.equal(metrics[0].value, '6');
          assert.equal(metrics[1].value, '0');
          assert.equal(metrics[2].value, language === 'zh' ? '\u5df2\u5173\u95ed' : 'Off');
          assert.equal(metrics[3].value, language === 'zh' ? '\u5df2\u8bbe\u7f6e' : 'Configured');
          let live;
          try {
            await page.evaluate(async () => {
              const fixture = workspaceFixture;
              fixture.state.connections.push({ ...structuredClone(fixture.state.connections[0]), id: 'synthetic-desktop-live', name: 'Synthetic desktop live metadata', favorite: false });
              fixture.state.browserBridge = { ...fixture.state.browserBridge, status: 'ready', enabled: true, connected: true, paired: true };
              fixture.desktopAgents = [{ clientId: 'synthetic-desktop-agent', displayName: 'Synthetic desktop agent', state: 'registered', canRegister: false, canRemove: false, canRepair: false }];
              await fixture.emit('state-changed');
            });
            await page.locator('.nav [data-page="settings"]').click();
            await settle(page, () => document.querySelector('.workspace-summary .workspace-metric:nth-child(2) strong')?.textContent.trim() === '1');
            await page.locator('.nav [data-page="connections"]').click();
            await page.evaluate(() => { workspaceFixture.owner.pinConfigured = false; window.dispatchEvent(new Event('focus')); });
            await settle(page, () => document.querySelector('#owner-lock-button').classList.contains('hidden'), null, 'Synthetic owner status must refresh before measuring PIN state');
            await page.evaluate(() => workspaceFixture.emit('state-changed'));
            live = await statusMetrics(page);
            assert.equal(live[0].value, '7', 'Total must refresh from state-changed');
            assert.equal(live[1].value, '1', 'Connected Agent count must refresh from the native scan result');
            assert.equal(live[2].value, language === 'zh' ? '\u5df2\u8fde\u63a5' : 'Connected', 'Bridge status must refresh from state-changed');
            assert.equal(live[3].value, language === 'zh' ? '\u672a\u8bbe\u7f6e' : 'Not configured', 'PIN state must refresh from synthetic owner status');
            assert.doesNotMatch(live.map(metric => metric.accessibleText).join(' '), /100\s*%\s*(?:secure|safe)|always authenticated|guaranteed (?:auth|security)|\u7edd\u5bf9\u5b89\u5168/iu);
          } finally {
            await page.evaluate(async () => {
              workspaceFixture.state.connections = workspaceFixture.state.connections.filter(item => item.id !== 'synthetic-desktop-live');
              workspaceFixture.state.browserBridge = { status: 'off', enabled: false, connected: false, paired: false, endpoint: 'synthetic-offline' };
              workspaceFixture.desktopAgents = [];
              workspaceFixture.owner.pinConfigured = true;
              window.dispatchEvent(new Event('focus'));
            });
            await settle(page, () => !document.querySelector('#owner-lock-button').classList.contains('hidden'));
            await page.locator('.nav [data-page="settings"]').click();
            await settle(page, () => document.querySelector('.workspace-summary .workspace-metric:nth-child(2) strong')?.textContent.trim() === '0');
            await page.locator('.nav [data-page="connections"]').click();
            await page.evaluate(() => workspaceFixture.emit('state-changed'));
          }
          assert.deepEqual((await statusMetrics(page)).map(metric => metric.value), metrics.map(metric => metric.value), 'All four values return to the original synthetic state');
          return { initial: metrics, live };
        });
        await check('soft neutral sidebar selection without a blue rail', async () => {
          const active = '.nav .nav-item.active';
          assert.equal(await page.locator(active).count(), 1);
          const box = await measure(page, active), rail = await measure(page, active, '::before');
          neutral(box.background, 'Active navigation');
          for (const pseudo of ['::before', '::after']) {
            const indicator = await measure(page, active, pseudo);
            const alpha = indicator.background.match(/[\d.]+/g)?.map(Number)[3] ?? 1;
            const visible = indicator.display !== 'none' && indicator.visibility !== 'hidden' && indicator.opacity > 0 && !['none', 'normal'].includes(indicator.content);
            assert.ok(!visible || (alpha === 0 && indicator.backgroundImage === 'none' && indicator.shadow === 'none'), `Active navigation must not paint a ${pseudo} rail`);
          }
          assert.doesNotMatch(box.shadow, /\binset\b/i, 'Active navigation must not recreate an inset selection rail; gentle drop shadows are allowed');
          assert.equal(box.backgroundImage, 'none', 'Active navigation must not recreate a gradient rail');
          assert.ok(box.borders.every(width => width <= 1) && Math.max(...box.borders) - Math.min(...box.borders) <= 0.5, 'Active navigation may have a thin even border, not a thick border rail');
          rounded(box, 6, 10, 'Active navigation');
          if (theme === 'light') assert.ok(Math.min(...rgb(box.background)) >= 245, `Light sidebar selection must be white, got ${box.background}`);
          if (viewport.width >= 760) {
            const sidebar = await measure(page, '.workspace-sidebar');
            assert.ok(sidebar.width <= 240, 'Sidebar must not consume dashboard-scale width');
            const label = await measure(page, '.nav .nav-item.active > span');
            assert.ok(label.fontSize >= 12 && label.fontSize <= 16, 'Compact sidebar labels must remain readable');
            assert.ok(box.height >= 30 && box.height <= 42, 'Primary navigation must use compact native rows');
          }
          return { box, rail };
        });
        await check('neutral app surfaces', async () => {
          const surfaces = [];
          for (const selector of ['.title-drag-region', '.main-content', '.workspace-sidebar']) {
            const box = await measure(page, selector);
            neutral(box.background, selector);
            const [red, , blue] = rgb(box.background);
            assert.ok(blue >= red - 3, `${selector} must remain neutral/cool grey, not warm tinted`);
            surfaces.push({ selector, background: box.background });
          }
          return surfaces;
        });
        if (viewport.width >= 1200) await check('desktop content stays centered and at most 1180px wide', async () => {
          const main = await measure(page, '.main-content');
          const content = [];
          for (const selector of ['.workspace-heading-row', '.workspace-toolbar', '#page-connections']) {
            const box = await measure(page, selector);
            assert.ok(box.width > 0 && box.width <= 1182, `${selector} must cap desktop content at about 1180px, got ${box.width}px`);
            assert.ok(Math.abs((box.x + box.right) / 2 - (main.x + main.right) / 2) <= 3, `${selector} must be centered within the main canvas`);
            content.push({ selector, ...box });
          }
          return content;
        });
        if (viewport.width >= 1200) await check('desktop list starts before y260 without a forced minimum height', async () => {
          const list = await measure(page, '.workspace-list-panel');
          assert.ok(list.y < 260, `Credential list must start before y260, got y${list.y}`);
          assert.ok(list.height > 0, 'Populated list must remain visible; empty-state compactness is tested separately');
          assert.ok(list.bottom <= viewport.height, 'List must fit inside the desktop window');
          return list;
        });
        await check('rounded vault group and controls', async () => {
          const list = await measure(page, '.workspace-list-panel');
          rounded(list, 10, 18, 'Vault list group');
          for (const selector of ['.workspace-toolbar .title-search', '#item-type-switch button[aria-pressed="true"]']) rounded(await measure(page, selector), 6, 10, selector);
          return list;
        });
        await check('muted charcoal primary action, not bright blue', async () => {
          const add = await measure(page, '#add-connection-button');
          primaryButton(add, theme, 'Add credential');
          return add;
        });
        await check('search, new action and labeled filters retained', async () => {
          await accessibleControl(page, '#title-search-input');
          await accessibleControl(page, '#add-connection-button');
          const group = page.locator('#item-type-switch');
          assert.equal(await group.getAttribute('role'), 'group');
          assert.ok((await group.getAttribute('aria-label'))?.trim(), 'Type filters need a group label');
          const labels = await group.locator('button').evaluateAll(buttons => buttons.map(button => ({ label: button.textContent.trim(), pressed: button.getAttribute('aria-pressed') })));
          assert.ok(labels.length >= 6 && labels.every(button => button.label && ['true', 'false'].includes(button.pressed)), 'Filters must keep labels and pressed state, not icon-only pills');
          await page.locator('#title-search-input').fill('Acme');
          await settle(page, () => document.querySelectorAll('#connections-list .connection-card').length === 1);
          await page.locator('#title-search-input').fill('');
          await settle(page, () => document.querySelectorAll('#connections-list .connection-card').length === 6);
          await page.locator('[data-item-type-filter="login"]').click();
          await settle(page, () => document.querySelectorAll('#connections-list .connection-card').length === 2);
          await page.locator('[data-item-type-filter="all"]').click();
          await settle(page, () => document.querySelectorAll('#connections-list .connection-card').length === 6);
          await assertMetadataOnly(page);
          return labels;
        });
        await check('keyboard-selectable metadata without private reads', async () => {
          const item = page.locator('.connection-card[data-item-id="ssh-operations"] .connection-name');
          await item.focus(); await page.keyboard.press('Enter');
          await settle(page, () => document.querySelector('#workspace-detail h2')?.textContent.includes('Operations host'));
          assert.equal(await item.getAttribute('aria-pressed'), 'true');
          assert.match(await page.locator('#workspace-detail').innerText(), /Operations folder with a deliberately long name/u);
          assert.equal(await page.locator('#connection-modal').isVisible(), false, 'Metadata selection must not open the private editor');
          await assertMetadataOnly(page);
        });
        if (viewport.width >= 1200) await check('wide populated vault keeps a content-fit metadata card', async () => {
          const list = await measure(page, '.workspace-list-panel');
          const detail = await measure(page, '#workspace-detail');
          assert.equal(await page.locator('#workspace-detail').isVisible(), true, 'Populated metadata inspector must remain visible');
          assert.equal(await page.locator('#workspace-detail').getAttribute('hidden'), null, 'Populated inspector must not retain the empty-vault hidden attribute');
          assert.ok(list.width >= 300 && detail.width >= 220, 'Both sides of the wide vault must remain usable');
          assert.ok(list.right <= detail.x && Math.abs(list.y - detail.y) <= 2, 'Wide vault keeps list and inspector side by side');
          rounded(detail, 10, 18, 'Metadata inspector');
          neutral(detail.background, 'Metadata inspector');
          if (theme === 'light') assert.ok(Math.min(...rgb(detail.background)) >= 245, 'Light metadata inspector uses a white surface');
          assert.ok(detail.borders.every(width => width <= 1), 'Metadata inspector allows a gentle border, not heavy framing');
          assert.doesNotMatch(detail.shadow, /\binset\b/i, 'Metadata inspector must not recreate an inset rail');
          const fit = await page.locator('#workspace-detail').evaluate(element => {
            const style = getComputedStyle(element);
            const last = [...element.children].filter(child => child.checkVisibility()).at(-1);
            return { scrolls: element.scrollHeight > element.clientHeight + 1, bottomGap: element.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom, bottomInset: parseFloat(style.paddingBottom) + parseFloat(style.borderBottomWidth) + parseFloat(getComputedStyle(last).marginBottom) };
          });
          if (!fit.scrolls) assert.ok(fit.bottomGap <= fit.bottomInset + 4, `Metadata card must fit its content, not stretch to match the list: ${fit.bottomGap}px bottom gap`);
          return { list, detail, fit };
        });
        await check('vault has no horizontal overflow', async () => assert.deepEqual(await noOverflow(page), []));
        await check('metadata screenshot', () => screenshot('metadata'));
        await check('settings stay compact and grouped', async () => {
          await page.locator('.nav [data-page="settings"]').click();
          await settle(page, () => document.querySelector('#page-settings').classList.contains('active'));
          const cards = await page.locator('#page-settings .settings-card').evaluateAll(elements => elements.filter(element => element.checkVisibility()).map(element => {
            const style = getComputedStyle(element), heading = element.querySelector('h2');
            return { title: heading?.textContent.trim(), padding: ['Top', 'Right', 'Bottom', 'Left'].map(side => parseFloat(style[`padding${side}`])), radius: parseFloat(style.borderTopLeftRadius), headingSize: heading ? parseFloat(getComputedStyle(heading).fontSize) : 0 };
          }));
          assert.ok(cards.length >= 4 && cards.every(card => card.title), 'Settings retain distinct named groups');
          assert.ok(cards.every(card => card.padding.every(value => value <= 20)), `Settings cards must use compact padding: ${JSON.stringify(cards)}`);
          assert.ok(cards.every(card => card.headingSize >= 13 && card.headingSize <= 18), 'Settings group headings must remain readable and compact');
          assert.ok((await page.locator('#settings-filter-switch').getAttribute('aria-label'))?.trim());
          await assertMetadataOnly(page);
          return cards;
        });
        await check('settings groups use softly rounded neutral cards', async () => {
          const cards = await page.locator('#page-settings .settings-card').all();
          const visible = [];
          for (const card of cards) {
            if (!await card.isVisible()) continue;
            const box = await card.evaluate(element => {
              const style = getComputedStyle(element);
              return { radii: ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'].map(corner => parseFloat(style[`border${corner}Radius`])), background: style.backgroundColor };
            });
            rounded(box, 10, 18, 'Settings group');
            neutral(box.background, 'Settings group');
            if (theme === 'light') assert.ok(Math.min(...rgb(box.background)) >= 245, 'Light settings groups use white surfaces');
            visible.push(box);
          }
          assert.ok(visible.length >= 4, 'Round-card contract must cover the real settings groups');
          return visible;
        });
        await check('settings primary action stays neutral and rounded', async () => {
          const primary = await measure(page, '#header-export-backup-button');
          primaryButton(primary, theme, 'Export backup');
          return primary;
        });
        await check('settings have no horizontal overflow', async () => assert.deepEqual(await noOverflow(page), []));
        await check('settings screenshot', () => screenshot('settings'));
        await check('add editor remains reachable without private reads', async () => {
          await page.locator('.nav [data-page="connections"]').click();
          await accessibleControl(page, '#add-connection-button');
          await page.locator('#add-connection-button').click();
          await page.locator('#connection-modal').waitFor({ state: 'visible' });
          const box = await measure(page, '#connection-modal .modal-card');
          assert.ok(box.x >= -1 && box.right <= viewport.width + 1 && box.y >= -1 && box.bottom <= viewport.height + 1, 'New credential editor must fit in this window');
          await assertMetadataOnly(page);
          await page.locator('#connection-modal .modal-header [data-close-modal]').click();
          await page.locator('#connection-modal').waitFor({ state: 'hidden' });
          return box;
        });
        await check('synthetic boundary and renderer errors', async () => {
          assert.deepEqual(pageErrors, [], 'No uncaught renderer errors');
          assert.deepEqual(blockedNetwork, [], 'Renderer must not attempt external network access');
          assert.deepEqual(await page.evaluate(() => workspaceFixture.unexpectedCommands), [], 'No real native command fallback');
          await assertMetadataOnly(page);
        });
        // A fresh page boots with an empty vault, not a filtered populated list.
        const emptyPage = await context.newPage();
        const emptyErrors = [];
        emptyPage.setDefaultTimeout(3000);
        emptyPage.setDefaultNavigationTimeout(10000);
        emptyPage.on('pageerror', error => emptyErrors.push(error.message));
        await installDesktopFixture(emptyPage, { language, theme, platform, empty: true });
        try {
          await emptyPage.goto(origin);
          await settle(emptyPage, () => document.querySelector('#workspace-empty-action') && document.querySelector('.workspace-summary .workspace-metric strong')?.textContent.trim() === '0', null, 'Empty vault must finish bootstrapping');
          await check('empty vault screenshot', () => screenshot('empty-vault', emptyPage));
          await check('empty vault hides the inspector with the hidden attribute', async () => {
            await assertMetadataOnly(emptyPage);
            assert.equal(await emptyPage.locator('#connections-list .connection-card').count(), 0, 'Empty vault must not show synthetic credentials');
            assert.equal(await emptyPage.locator('#workspace-detail').evaluate(element => element.hasAttribute('hidden')), true, 'Empty vault inspector must use the hidden attribute, not just placeholder content');
            assert.equal(await emptyPage.locator('#workspace-detail').isVisible(), false, 'Hidden inspector must not occupy a second visible box');
          });
          await check('empty vault fits one compact full-width panel', async () => {
            const layout = await measure(emptyPage, '.workspace-vault-layout');
            const panel = await measure(emptyPage, '.workspace-list-panel');
            const empty = await measure(emptyPage, '#connections-list .empty-state');
            assert.ok(panel.height > 0 && panel.height <= 370, `Empty vault panel must fit its content within 370px, got ${panel.height}px`);
            assert.ok(layout.height > 0 && layout.height <= 370, `Empty layout must not reserve a tall blank canvas, got ${layout.height}px`);
            assert.ok(Math.abs(panel.x - layout.x) <= 2 && Math.abs(panel.right - layout.right) <= 2, 'Empty panel must use the full contained vault width without reserving an inspector column');
            assert.ok(empty.width > 0 && empty.height > 0 && empty.x >= panel.x && empty.right <= panel.right + 1 && empty.y >= panel.y && empty.bottom <= panel.bottom + 1, 'Empty state must be contained inside its single panel');
            if (viewport.width >= 1200) assert.ok(panel.y < 260, `Empty vault list must start before y260, got y${panel.y}`);
            rounded(panel, 10, 18, 'Empty vault group');
            const strip = await measure(emptyPage, '.workspace-summary');
            assert.ok(strip.height > 0 && strip.height <= 38, 'Empty vault retains the real compact bottom status strip');
            assert.equal((await statusMetrics(emptyPage))[0].value, '0', 'Empty-vault counter must reflect native metadata');
            return { layout, panel, empty, strip };
          });
          await check('empty vault primary action stays neutral and rounded', async () => {
            primaryButton(await measure(emptyPage, '#workspace-empty-action'), theme, 'Empty vault add action');
          });
          await check('empty vault add action and synthetic safety remain functional', async () => {
            const button = await accessibleControl(emptyPage, '#workspace-empty-action');
            assert.deepEqual(await noOverflow(emptyPage), []);
            await emptyPage.locator('#workspace-empty-action').click();
            await emptyPage.locator('#connection-modal').waitFor({ state: 'visible' });
            await assertMetadataOnly(emptyPage);
            assert.deepEqual(emptyErrors, [], 'Empty vault must have no uncaught renderer errors');
            assert.deepEqual(blockedNetwork, [], 'Empty vault must not attempt external network access');
            assert.deepEqual(await emptyPage.evaluate(() => workspaceFixture.unexpectedCommands), [], 'Empty vault must not fall back to real native commands');
            return button;
          });
        } finally { await emptyPage.close(); }
      } catch (error) {
        results.push({ scenario, name: 'scenario harness', ok: false, error: error.message, stack: error.stack, pageErrors, blockedNetwork });
        await screenshot('harness-failure').catch(() => {});
      } finally { await context.close(); }
  }
} catch (error) {
  results.push({ name: 'desktop test harness', ok: false, error: error.message, stack: error.stack });
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}

const report = {
  ok: results.length > 0 && results.every(result => result.ok),
  passed: results.filter(result => result.ok).length, failed: results.filter(result => !result.ok).length,
  channel: process.env.PLAYWRIGHT_CHANNEL || 'chromium', capturedAt, source, artifacts, fingerprints,
  reference: { path: '/Applications/magpie.app', bundleIdentifier: 'com.yetone.magpie', product: 'yetone Agent manager, not Blinue/Magpie WinUI' },
  isolation: 'Immutable renderer snapshot; shared synthetic Tauri fixture; exact loopback origin only; service workers and WebSockets blocked; no real vault/native app',
  scope: 'Native desktop layout/behavior contract, not full pixel fidelity or exact platform font fallback', results,
};
const reportFile = path.join(artifacts, 'report.json');
await fs.writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ok: report.ok, passed: report.passed, failed: report.failed, artifacts, report: reportFile }, null, 2));
if (!report.ok) process.exitCode = 1;
