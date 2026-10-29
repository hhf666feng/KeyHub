// Run: PLAYWRIGHT_CHANNEL=chrome node scripts/test-workspace-ui.mjs
// Browser-only regression suite: immutable renderer snapshot + synthetic Tauri.
// WORKSPACE_RENDERER_DIR can pin a previous snapshot while the renderer is edited.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createWorkspaceFixture, installWorkspaceFixture, WORKSPACE_FOLDER, WORKSPACE_PASSWORD, WORKSPACE_PIN } from './fixtures/workspace.mjs';

const source = process.env.WORKSPACE_RENDERER_DIR
  ? path.resolve(process.env.WORKSPACE_RENDERER_DIR)
  : path.resolve(import.meta.dirname, '../renderer');
const artifacts = await fs.mkdtemp(path.join(os.tmpdir(), 'openkeylet-workspace-ui-'));
const renderer = path.join(artifacts, 'renderer-snapshot');
await fs.cp(source, renderer, { recursive: true });
const fingerprints = {};
for (const file of await fs.readdir(renderer)) {
  if ((await fs.stat(path.join(renderer, file))).isFile()) {
    fingerprints[file] = createHash('sha256').update(await fs.readFile(path.join(renderer, file))).digest('hex');
  }
}
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const file = path.resolve(renderer, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!file.startsWith(`${renderer}${path.sep}`)) {
      response.writeHead(403); response.end(); return;
    }
    const body = await fs.readFile(file);
    response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(body);
  } catch {
    response.writeHead(404); response.end();
  }
});

const allIds = ['login-acme', 'login-personal', 'api-build', 'ssh-operations', 'card-travel', 'note-recovery'];
const tests = [];
const test = (name, run, options = {}) => tests.push({ name, run, options });
const row = (page, id) => page.locator(`.connection-card[data-item-id="${id}"]`);

async function requireElement(page, selector, message = selector) {
  assert.equal(await page.locator(selector).count(), 1, `Missing workspace contract: ${message}`);
}

async function waitUntil(page, predicate, argument, message = 'Renderer condition did not settle') {
  // Playwright waitForFunction uses eval internally; preserve the renderer's CSP.
  const deadline = Date.now() + 2500;
  while (Date.now() < deadline) {
    if (await page.evaluate(predicate, argument)) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.fail(message);
}

async function expectItems(page, expected) {
  const sorted = [...expected].sort();
  await waitUntil(page, ids => JSON.stringify([...document.querySelectorAll('#connections-list .connection-card')].map(item => item.dataset.itemId).sort()) === JSON.stringify(ids), sorted, 'Visible items did not settle after filtering').catch(() => {});
  assert.deepEqual(await page.locator('#connections-list .connection-card').evaluateAll(items => items.map(item => item.dataset.itemId).sort()), sorted, 'Visible items must match the combined filters');
}

async function search(page, query) {
  const input = page.locator('#title-search-input');
  if (!await input.isVisible()) await page.locator('#title-search-toggle').click();
  await input.fill(query);
}

async function secretCalls(page) {
  return page.evaluate(() => workspaceFixture.calls.filter(call => call.command === 'owner_secret_view'));
}

async function assertNoSecretDOM(page) {
  const leaks = await page.evaluate(() => {
    const values = Object.values(workspaceFixture.privateById).flatMap(item => Object.values(item));
    const html = document.body.innerHTML;
    const controls = [...document.querySelectorAll('input, textarea')].map(input => input.value);
    return values.filter(value => value && (html.includes(value) || controls.some(control => control.includes(value))));
  });
  assert.deepEqual(leaks, [], 'Synthetic private values must not remain in the DOM, including hidden editor fields');
}

async function assertNoOverflow(page) {
  const issues = await page.evaluate(() => {
    const failures = [];
    if (document.documentElement.scrollWidth > innerWidth + 1) failures.push(`document ${document.documentElement.scrollWidth}px > viewport ${innerWidth}px`);
    for (const element of document.querySelectorAll('.workspace-toolbar, .workspace-summary, .workspace-sidebar, #workspace-detail, .connection-card, .settings-card')) {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (!box.width || !box.height || style.visibility === 'hidden' || style.display === 'none') continue;
      if (box.left < -1 || box.right > innerWidth + 1) failures.push(`${element.id || element.className}: outside viewport`);
      if (element.scrollWidth > element.clientWidth + 1 && !['auto', 'scroll'].includes(style.overflowX)) failures.push(`${element.id || element.className}: clipped horizontal content`);
    }
    return failures;
  });
  assert.deepEqual(issues, [], 'Workspace must not have horizontal overflow or clipped content');
}

async function selectPreview(page, id) {
  await requireElement(page, '#workspace-detail');
  await row(page, id).locator('.connection-name').click();
  await page.locator('#workspace-detail').waitFor({ state: 'visible' });
  const name = await page.evaluate(itemId => workspaceFixture.state.connections.find(item => item.id === itemId).name, id);
  await waitUntil(page, expected => document.querySelector('#workspace-detail')?.innerText.includes(expected), name, 'Selecting a card must update the metadata preview');
}

async function closeEditor(page) {
  await page.locator('#connection-modal .modal-header [data-close-modal]').click();
  await page.locator('#connection-modal').waitFor({ state: 'hidden' });
}

async function enterPin(page, pin) {
  const cells = page.locator('[data-pin-group="owner-pin"] input');
  for (let index = 0; index < pin.length; index++) await cells.nth(index).fill(pin[index]);
  await page.locator('#owner-unlock-action').click();
}

for (const viewport of [{ width: 1200, height: 800 }, { width: 760, height: 900 }, { width: 390, height: 844 }]) {
  for (const language of ['en', 'zh']) for (const theme of ['light', 'dark']) {
    test(`workspace shell ${language}/${theme} ${viewport.width}x${viewport.height}`, async page => {
      for (const selector of ['#workspace-heading', '#workspace-description', '.workspace-toolbar', '.workspace-sidebar', '.workspace-sidebar .nav', '.workspace-summary', '#workspace-detail']) await requireElement(page, selector);
      const heading = (await page.locator('#workspace-heading').innerText()).trim();
      const description = (await page.locator('#workspace-description').innerText()).trim();
      assert.ok(heading.length > 0 && description.length > 0, 'Heading and description must be meaningful localized text');
      for (const text of [heading, description]) assert.equal(/[\u3400-\u9fff]/u.test(text), language === 'zh', 'Workspace copy must follow the selected language');
      assert.equal(await page.locator('html').getAttribute('lang'), language === 'zh' ? 'zh-CN' : 'en');
      assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
      for (const filter of ['all', 'favorites']) await requireElement(page, `.workspace-sidebar button[data-workspace-filter="${filter}"]`);
      assert.deepEqual((await page.locator('.workspace-sidebar button[data-workspace-folder]').evaluateAll(buttons => buttons.map(button => button.dataset.workspaceFolder))).sort(), ['Work', 'Personal', WORKSPACE_FOLDER].sort());
      if (viewport.width >= 760) {
        await requireElement(page, '.workspace-toolbar #title-search-input');
        assert.equal(await page.locator('#title-search-input').isVisible(), true, 'Search is always visible at desktop/tablet widths without a toggle');
        await page.locator('#workspace-heading').click();
        assert.equal(await page.locator('#title-search-input').isVisible(), true, 'Clicking outside must not collapse desktop search');
      }
      await assertNoOverflow(page);
      await assertNoSecretDOM(page);
    }, { viewport, language, theme });
  }
}

test('primary action labels keep readable contrast at rest and hover in both themes', async page => {
  const contrast = async selector => page.locator(selector).evaluate(element => {
    const style = getComputedStyle(element);
    const luminance = color => {
      const rgb = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => {
        const channel = value / 255;
        return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
      });
      return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
    };
    const foreground = luminance(style.color), background = luminance(style.backgroundColor);
    return (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05);
  });
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => OpenKeyletAppearance.setTheme(theme === 'light'), theme);
    for (const selector of ['#add-connection-button', '#workspace-detail-edit']) {
      await page.mouse.move(0, 0);
      assert.ok(await contrast(selector) >= 4.5, `${theme} ${selector}: resting label contrast`);
      await page.locator(selector).hover();
      assert.ok(await contrast(selector) >= 4.5, `${theme} ${selector}: hover label contrast`);
    }
  }
});

test('narrow workspace retains window, sound and named agent controls', async page => {
  for (const selector of ['[data-window-action="minimize"]', '[data-window-action="maximize"]', '[data-window-action="close"]', '#sound-toggle']) {
    assert.equal(await page.locator(selector).isVisible(), true, `${selector} must remain available in small native windows`);
  }
  await page.locator('#sound-toggle').click();
  assert.equal(await page.locator('#sound-toggle').getAttribute('aria-checked'), 'true');
  await page.locator('#sound-toggle').click();
  assert.equal(await page.locator('#sound-toggle').getAttribute('aria-checked'), 'false');
  assert.equal(await page.locator('[data-workspace-settings="MCP"]').getAttribute('aria-label'), '接入 AI Agent');
  const touchAction = await page.locator('#item-type-switch').evaluate(element => getComputedStyle(element).touchAction);
  assert.ok(['auto', 'pan-x', 'pan-x pan-y', 'manipulation'].includes(touchAction), `Horizontal type filters must permit touch panning, got ${touchAction}`);
  await assertNoOverflow(page);
}, { viewport: { width: 390, height: 844 }, language: 'zh', theme: 'light' });

test('search matches names, folders and metadata; Escape clears results', async page => {
  await search(page, 'aCmE'); await expectItems(page, ['login-acme']);
  await search(page, 'Personal'); await expectItems(page, ['login-personal', 'card-travel']);
  await search(page, 'Pipeline deployment'); await expectItems(page, ['api-build']);
  await search(page, 'synthetic-no-such-item'); await expectItems(page, []);
  assert.equal(await page.locator('#connections-list .empty-state').isVisible(), true);
  await page.keyboard.press('Escape'); await expectItems(page, allIds);
  assert.deepEqual(await secretCalls(page), [], 'Search must use public metadata only');
});

test('existing type filters intersect search and reset correctly', async page => {
  for (const [kind, ids] of [['login', ['login-acme', 'login-personal']], ['api', ['api-build']], ['ssh', ['ssh-operations']], ['card', ['card-travel']], ['secureNote', ['note-recovery']], ['all', allIds]]) {
    await page.locator(`[data-item-type-filter="${kind}"]`).click();
    await expectItems(page, ids);
    assert.equal(await page.locator(`[data-item-type-filter="${kind}"]`).getAttribute('aria-pressed'), 'true');
  }
  await page.locator('[data-item-type-filter="login"]').click();
  await search(page, 'Personal'); await expectItems(page, ['login-personal']);
  await page.locator('[data-item-type-filter="all"]').click();
  await expectItems(page, ['login-personal', 'card-travel']);
  await search(page, ''); await expectItems(page, allIds);
});

test('favorites intersect search and type filters without modifying items', async page => {
  await requireElement(page, '.workspace-sidebar [data-workspace-filter="favorites"]');
  await page.locator('[data-workspace-filter="favorites"]').click();
  await expectItems(page, ['login-acme', 'api-build']);
  await search(page, 'Build'); await expectItems(page, ['api-build']);
  await page.locator('[data-item-type-filter="login"]').click(); await expectItems(page, []);
  await search(page, ''); await expectItems(page, ['login-acme']);
  await page.locator('[data-item-type-filter="all"]').click(); await expectItems(page, ['login-acme', 'api-build']);
  await page.locator('[data-workspace-filter="all"]').click(); await expectItems(page, allIds);
  assert.equal(await page.evaluate(() => workspaceFixture.saved.length), 0);
  assert.deepEqual(await secretCalls(page), []);
});

test('dynamic folder navigation intersects type filters and returns to all', async page => {
  await requireElement(page, '.workspace-sidebar [data-workspace-folder="Work"]');
  await page.locator('[data-workspace-folder="Work"]').click(); await expectItems(page, ['login-acme', 'api-build', 'note-recovery']);
  await page.locator('[data-item-type-filter="login"]').click(); await expectItems(page, ['login-acme']);
  await page.locator('[data-item-type-filter="all"]').click();
  await page.locator('[data-workspace-folder="Personal"]').click(); await expectItems(page, ['login-personal', 'card-travel']);
  await page.locator(`[data-workspace-folder="${WORKSPACE_FOLDER}"]`).click(); await expectItems(page, ['ssh-operations']);
  await page.locator('[data-workspace-filter="all"]').click(); await expectItems(page, allIds);
  assert.deepEqual(await secretCalls(page), []);
});

test('selecting a credential shows metadata only and never requests plaintext', async page => {
  await selectPreview(page, 'login-acme');
  assert.equal(await page.locator('#connection-modal').isVisible(), false, 'Selection is not editing');
  assert.match(await page.locator('#workspace-detail').innerText(), /Acme console/);
  assert.match(await page.locator('#workspace-detail').innerText(), /Work/);
  assert.equal(await page.locator('#workspace-detail input, #workspace-detail textarea, #workspace-detail [data-secret-value]').count(), 0, 'Metadata preview must not contain secret editor controls');
  await selectPreview(page, 'login-personal');
  assert.doesNotMatch(await page.locator('#workspace-detail').innerText(), /Acme console/);
  assert.deepEqual(await secretCalls(page), [], 'Neither selection may call owner_secret_view');
  await assertNoSecretDOM(page);
});

test('explicit preview edit opens the existing secret editor', async page => {
  await selectPreview(page, 'login-acme');
  assert.deepEqual(await secretCalls(page), []);
  await requireElement(page, '#workspace-detail-edit');
  await page.locator('#workspace-detail-edit').click();
  await page.locator('#connection-modal').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#connection-name').inputValue(), 'Acme console');
  assert.equal(await page.locator('#connection-folder').inputValue(), 'Work');
  assert.equal(await page.locator('[data-kind="password"] [data-secret-value]').inputValue(), WORKSPACE_PASSWORD);
  assert.deepEqual((await secretCalls(page)).map(call => call.args.id), ['login-acme']);
  await closeEditor(page);
  await assertNoSecretDOM(page);
});

test('existing editor creates, edits and deletes with revision guards and cancel', async page => {
  await page.locator('#add-connection-button').click();
  await page.locator('[data-item-template="login"]').click();
  await page.locator('#connection-name').fill('Synthetic created login');
  await page.locator('#connection-folder').fill('Synthetic new folder');
  await page.locator('[data-kind="password"] [data-secret-value]').fill('synthetic-created-password');
  await page.locator('#save-connection-button').click();
  await page.locator('#connection-modal').waitFor({ state: 'hidden' });
  await waitUntil(page, () => workspaceFixture.saved.length === 1);
  const firstSave = await page.evaluate(() => workspaceFixture.saved[0]);
  assert.equal(firstSave.input.itemType, 'login');
  assert.equal(firstSave.input.folder, 'Synthetic new folder');
  assert.equal(firstSave.input.favorite, false);
  assert.equal(firstSave.input.enabled, true);
  assert.equal(firstSave.expectedUpdatedAt, null);
  assert.equal(firstSave.input.secrets.password || firstSave.input.secrets.namedSecrets.password, 'synthetic-created-password');
  const created = await page.evaluate(() => workspaceFixture.state.connections.find(item => item.name === 'Synthetic created login'));
  await expectItems(page, [...allIds, created.id]);
  await row(page, created.id).locator('[data-action="edit"]').click();
  await page.locator('#connection-modal').waitFor({ state: 'visible' });
  assert.equal(await page.locator('[data-kind="password"] [data-secret-value]').inputValue(), 'synthetic-created-password');
  await page.locator('#connection-name').fill('Synthetic renamed login');
  await page.locator('[data-kind="password"] [data-secret-value]').fill('synthetic-updated-password');
  await page.locator('#save-connection-button').click();
  await page.locator('#connection-modal').waitFor({ state: 'hidden' });
  const secondSave = await page.evaluate(() => workspaceFixture.saved[1]);
  assert.equal(secondSave.input.id, created.id);
  assert.equal(secondSave.expectedUpdatedAt, created.updatedAt);
  assert.equal(await page.evaluate(() => workspaceFixture.state.connections.filter(item => item.name === 'Synthetic renamed login').length), 1);
  await row(page, created.id).locator('.workspace-more').click();
  await row(page, created.id).locator('[data-action="delete"]').click();
  await page.locator('#confirmation-cancel').click();
  assert.equal(await page.evaluate(() => workspaceFixture.deleted.length), 0, 'Cancel must not delete');
  await row(page, created.id).locator('.workspace-more').click();
  await row(page, created.id).locator('[data-action="delete"]').click();
  await page.locator('#confirmation-accept').click();
  await expectItems(page, allIds);
  const deletion = await page.evaluate(() => workspaceFixture.deleted[0]);
  assert.equal(deletion.id, created.id);
  assert.equal(deletion.expectedUpdatedAt, await page.evaluate(() => workspaceFixture.trash[0].item.updatedAt));
});

for (const language of ['zh', 'en']) {
  test(`saved credentials without actions are not drafts and status clicks never toggle ${language}`, async page => {
    await page.locator('#add-connection-button').click();
    await page.locator('[data-item-template="ssh"]').click();
    await page.locator('#connection-name').fill('Synthetic saved server');
    await page.locator('#save-connection-button').click();
    await page.locator('#connection-modal').waitFor({ state: 'hidden' });
    const created = await page.evaluate(() => workspaceFixture.state.connections.find(item => item.name === 'Synthetic saved server'));
    assert.equal(created.enabled, true);
    assert.deepEqual(created.capabilities, []);
    const card = row(page, created.id);
    const subtitle = await card.locator('.connection-name small').innerText();
    assert.doesNotMatch(subtitle, /草稿|DRAFT/i, 'Persisted records must never be mislabeled as editor drafts');
    assert.match(subtitle, language === 'zh' ? /已保存.*暂无可用动作/ : /Saved.*No available actions/i);
    await card.locator('.connection-name small').click();
    assert.equal(await page.locator('#workspace-detail h2').innerText(), created.name);
    assert.equal(await card.locator('[data-action="toggle-enabled"]').count(), 0, 'No hidden immediate toggle in the list');
    const status = card.locator('.workspace-item-state');
    assert.equal(await status.getAttribute('data-enabled'), 'true');
    assert.match(await status.innerText(), language === 'zh' ? /已启用/ : /Enabled/);
    await status.click();
    assert.equal(await page.evaluate(id => workspaceFixture.state.connections.find(item => item.id === id).enabled, created.id), true);
    assert.equal(await page.evaluate(() => workspaceFixture.calls.filter(call => call.command === 'set_connection_enabled').length), 0);
    assert.deepEqual(await secretCalls(page), []);
    assert.equal(await page.evaluate(() => workspaceFixture.drafts.length), 0);
    assert.equal(await page.locator('#drafts-button').isDisabled(), true);
    assert.match(await page.locator('.workspace-action-help').innerText(), language === 'zh' ? /编辑.*凭据/ : /Edit.*credential/i);
  }, { language });
}

test('enabled changes require an explicit editor change and save', async page => {
  await row(page, 'login-acme').locator('.item-disclosure').click();
  await page.locator('#connection-modal').waitFor({ state: 'visible' });
  await page.locator('.switch:has(#connection-enabled)').click();
  assert.equal(await page.locator('#connection-enabled').isChecked(), false);
  assert.equal(await page.evaluate(() => workspaceFixture.state.connections.find(item => item.id === 'login-acme').enabled), true, 'Editing does not immediately disable a stored item');
  await page.locator('#save-connection-button').click();
  await page.locator('#connection-modal').waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => workspaceFixture.state.connections.find(item => item.id === 'login-acme').enabled), false);
  assert.equal(await row(page, 'login-acme').locator('.workspace-item-state').getAttribute('data-enabled'), 'false');
  assert.equal(await page.evaluate(() => workspaceFixture.state.connections.filter(item => item.enabled).length), 3);
  assert.equal(await page.evaluate(() => workspaceFixture.calls.filter(call => call.command === 'set_connection_enabled').length), 0);
});

test('existing drafts retain unsaved values without creating a credential', async page => {
  assert.equal(await page.locator('#drafts-button').isDisabled(), true);
  await page.locator('#add-connection-button').click();
  await page.locator('[data-item-template="login"]').click();
  await page.locator('#connection-name').fill('Synthetic workspace draft');
  await page.locator('[data-kind="password"] [data-secret-value]').fill('synthetic-workspace-draft-password');
  await page.keyboard.press('Escape');
  await page.locator('#connection-modal').waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => workspaceFixture.saved.length), 0);
  assert.equal(await page.evaluate(() => workspaceFixture.drafts.length), 1);
  assert.equal(await page.locator('#drafts-button').isEnabled(), true);
  await page.locator('#drafts-button').click();
  assert.equal(await page.locator('#connection-name').inputValue(), 'Synthetic workspace draft');
  assert.equal(await page.locator('[data-kind="password"] [data-secret-value]').inputValue(), 'synthetic-workspace-draft-password');
  assert.equal(await page.locator('.creation-control').getAttribute('data-mode'), 'draft');
  await closeEditor(page);
  await page.locator('#add-connection-button').click();
  assert.equal(await page.locator('#connection-name').inputValue(), '');
  assert.equal(await page.evaluate(() => workspaceFixture.drafts.length), 1, 'Starting a new item must preserve the draft');
});

for (const shortcut of ['Control+k', 'Meta+k']) {
  test(`${shortcut} focuses search without stealing editor input`, async page => {
    await page.locator('#connections-list').focus();
    await page.keyboard.press(shortcut);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'title-search-input', `${shortcut} must focus workspace search`);
    await page.keyboard.type('Acme'); await expectItems(page, ['login-acme']);
    await page.keyboard.press('Escape'); await expectItems(page, allIds);
    await page.locator('#add-connection-button').click();
    await page.locator('#connection-name').focus();
    await page.keyboard.press(shortcut);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'connection-name', 'Search shortcut must not interrupt the editor');
  });
}

test('existing sidebar navigation preserves activity, settings and vault routes', async page => {
  for (const target of ['activity', 'settings', 'connections']) {
    await page.locator(`.nav [data-page="${target}"]`).click();
    assert.equal(await page.locator(`#page-${target}`).isVisible(), true);
    assert.equal(await page.locator(`.nav [data-page="${target}"]`).getAttribute('aria-current'), 'page');
    assert.equal(await page.locator('.page.active').count(), 1);
  }
  await expectItems(page, allIds);
});

test('workspace Agent setup shortcut opens the MCP settings section', async page => {
  await requireElement(page, '[data-workspace-settings="MCP"]');
  await page.locator('[data-workspace-settings="MCP"]').click();
  assert.equal(await page.locator('#page-settings').isVisible(), true);
  assert.equal(await page.locator('[data-settings-filter="MCP"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('.settings-card[data-module="MCP / 02"]').isVisible(), true);
  for (const section of ['SYSTEM / 01', 'APP / 03', 'WEB / 04', 'CLOUD / 05', 'SAFE / 05']) assert.equal(await page.locator(`.settings-card[data-module="${section}"]`).isVisible(), false, 'MCP shortcut must select the MCP section, not just the settings route');
});

test('empty workspace action opens the unchanged add editor', async page => {
  await requireElement(page, '#workspace-empty-action');
  assert.equal(await page.locator('#workspace-empty-action').isVisible(), true);
  await page.locator('#workspace-empty-action').click();
  await page.locator('#connection-modal').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#connection-name').inputValue(), '');
  assert.equal(await page.locator('#template-picker').isVisible(), true);
  assert.deepEqual(await secretCalls(page), []);
}, { empty: true });

test('workspace summary and folders reflect live data without auth guarantees', async page => {
  await requireElement(page, '.workspace-summary');
  const summary = () => page.locator('.workspace-summary').evaluate(element => [element.innerText, ...[element, ...element.querySelectorAll('[aria-label], [title]')].map(item => `${item.getAttribute('aria-label') || ''} ${item.getAttribute('title') || ''}`)].join(' '));
  const before = await summary();
  assert.match(before, /(?:^|\D)0*6(?:\D|$)/, 'Summary must expose the actual total, not static decorative numbers');
  const unsupportedGuarantee = /100\s*%\s*(?:secure|safe)|always authenticated|authentication (?:is )?guaranteed|guaranteed (?:auth|security)|\u7edd\u5bf9\u5b89\u5168|\u6c38\u4e0d\u6cc4\u9732/iu;
  assert.doesNotMatch(before, unsupportedGuarantee, 'Service readiness is not an authentication/security guarantee');
  await page.evaluate(async () => {
    workspaceFixture.state.connections.push({ ...structuredClone(workspaceFixture.state.connections[0]), id: 'synthetic-live-addition', name: 'Synthetic live item', folder: 'New live folder', favorite: false });
    await workspaceFixture.emit('state-changed');
  });
  await expectItems(page, [...allIds, 'synthetic-live-addition']);
  const after = await summary();
  assert.notEqual(after, before, 'Summary must refresh after a state-changed event');
  assert.match(after, /(?:^|\D)0*7(?:\D|$)/);
  assert.doesNotMatch(after, unsupportedGuarantee);
  await requireElement(page, '[data-workspace-folder="New live folder"]');
  await page.locator('[data-workspace-folder="New live folder"]').click(); await expectItems(page, ['synthetic-live-addition']);
  await page.evaluate(async () => {
    workspaceFixture.state.connections = workspaceFixture.state.connections.filter(item => item.id !== 'synthetic-live-addition');
    await workspaceFixture.emit('state-changed');
  });
  assert.equal(await page.locator('[data-workspace-folder="New live folder"]').count(), 0, 'Empty folder entries must not remain stale');
  await page.locator('[data-workspace-filter="all"]').click(); await expectItems(page, allIds);
  assert.match(await summary(), /(?:^|\D)0*6(?:\D|$)/);
});

test('initial locked state has no plaintext preview or private reads', async page => {
  await requireElement(page, '#workspace-detail');
  assert.equal(await page.locator('#owner-lock-layer').isVisible(), true);
  assert.equal(await page.locator('#connection-modal').isVisible(), false);
  assert.deepEqual(await secretCalls(page), []);
  assert.equal(await page.evaluate(() => workspaceFixture.calls.filter(call => call.command === 'owner_editor_drafts').length), 0, 'Locked startup must not fetch private drafts');
  await assertNoSecretDOM(page);
  await assertNoOverflow(page);
}, { locked: true, viewport: { width: 390, height: 844 }, language: 'zh', theme: 'light' });

test('existing PIN rejects an incorrect code, unlocks explicitly and relocks', async page => {
  assert.equal(await page.locator('#owner-lock-layer').isVisible(), true);
  await assertNoSecretDOM(page);
  await enterPin(page, '000000');
  await waitUntil(page, () => !document.querySelector('#owner-unlock-action').disabled);
  assert.equal(await page.locator('#owner-lock-layer').isVisible(), true);
  assert.equal(await page.evaluate(() => workspaceFixture.owner.unlocked), false);
  await enterPin(page, WORKSPACE_PIN);
  await page.locator('#owner-lock-layer').waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => workspaceFixture.owner.unlocked), true);
  await page.locator('#owner-lock-button').click();
  await page.locator('#owner-lock-layer').waitFor({ state: 'visible' });
  assert.equal(await page.evaluate(() => workspaceFixture.owner.unlocked), false);
  assert.deepEqual(await secretCalls(page), [], 'PIN transitions must not request item plaintext');
  await assertNoSecretDOM(page);
}, { locked: true });

test('locking clears the editor and preview secrets; PIN unlock remains explicit', async page => {
  await selectPreview(page, 'login-acme');
  await page.locator('#workspace-detail-edit').click();
  await page.locator('#connection-modal').waitFor({ state: 'visible' });
  assert.equal(await page.locator('[data-kind="password"] [data-secret-value]').inputValue(), WORKSPACE_PASSWORD);
  await page.locator('#owner-lock-button').click();
  await page.locator('#owner-lock-layer').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#connection-modal').isVisible(), false);
  await assertNoSecretDOM(page);
  const countAtLock = (await secretCalls(page)).length;
  await enterPin(page, '000000');
  await waitUntil(page, () => !document.querySelector('#owner-unlock-action').disabled);
  assert.equal(await page.locator('#owner-lock-layer').isVisible(), true, 'Wrong PIN must not unlock');
  await assertNoSecretDOM(page);
  await enterPin(page, WORKSPACE_PIN);
  await page.locator('#owner-lock-layer').waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => workspaceFixture.owner.unlocked), true);
  assert.equal((await secretCalls(page)).length, countAtLock, 'Unlock must not fetch selected-item secrets automatically');
  await assertNoSecretDOM(page);
});

test('mobile selection, settings navigation and add editor stay within viewport', async page => {
  await selectPreview(page, 'ssh-operations');
  await assertNoOverflow(page);
  await requireElement(page, '[data-workspace-settings="MCP"]');
  await page.locator('[data-workspace-settings="MCP"]').click();
  await assertNoOverflow(page);
  await page.locator('.nav [data-page="connections"]').click();
  await page.locator('#add-connection-button').click();
  await page.locator('#connection-modal').waitFor({ state: 'visible' });
  const box = await page.locator('#connection-modal .modal-card').boundingBox();
  assert.ok(box && box.x >= -1 && box.x + box.width <= 391 && box.y >= -1 && box.y + box.height <= 845, 'Mobile editor must fit inside the viewport');
  await assertNoOverflow(page);
}, { viewport: { width: 390, height: 844 }, language: 'zh', theme: 'light' });

test('canceling a filtered reorder keeps focus on its original handle', async page => {
  await search(page, 'Personal');
  await expectItems(page, ['login-personal', 'card-travel']);
  const handle = row(page, 'login-personal').locator('[data-item-reorder]');
  await handle.focus();
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 12, { steps: 4 });
  await waitUntil(page, () => document.querySelector('#connections-list').classList.contains('is-reordering'));
  await page.keyboard.press('Escape');
  await page.mouse.up();
  assert.equal(await page.evaluate(() => document.activeElement.dataset.itemReorder), 'login-personal', 'Canceled drag must not replace the focused handle');
  assert.equal(await page.evaluate(() => workspaceFixture.calls.filter(call => call.command === 'reorder_connections').length), 0);
});

for (const viewport of [{ width: 760, height: 600 }, { width: 1090, height: 800 }]) {
  test(`stacked list and inspector do not overlap at ${viewport.width}px`, async page => {
    const boxes = await page.evaluate(() => {
      const list = document.querySelector('.workspace-list-panel').getBoundingClientRect();
      const detail = document.querySelector('#workspace-detail').getBoundingClientRect();
      return { listBottom: list.bottom, detailTop: detail.top };
    });
    assert.ok(boxes.detailTop >= boxes.listBottom, `Inspector must follow the list: ${JSON.stringify(boxes)}`);
    await page.locator('#workspace-detail').scrollIntoViewIfNeeded();
    const hit = await page.locator('#workspace-detail h2').evaluate(element => {
      const rect = element.getBoundingClientRect();
      const target = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return target === element || element.contains(target);
    });
    assert.equal(hit, true, 'List must not intercept inspector pointer targets');
  }, { viewport });
}

const results = [];
test('menu-bar preference is saved as an isolated settings patch and failure restores state', async page => {
  await page.evaluate(async () => { document.documentElement.classList.add('platform-macos'); await workspaceFixture.emit('state-changed'); });
  await page.locator('[data-workspace-settings="MCP"]').click();
  await page.locator('[data-settings-filter="APP"]').click();
  const toggle = page.locator('#menu-bar-only-enabled');
  assert.equal(await toggle.isChecked(), false);
  await page.locator('#menu-bar-only-option .switch').click();
  await waitUntil(page, () => workspaceFixture.state.settings.menuBarOnly === true);
  const patches = await page.evaluate(() => workspaceFixture.calls.filter(call => call.command === 'update_settings').map(call => call.args.patch));
  assert.deepEqual(patches.at(-1), { menuBarOnly: true });
  await waitUntil(page, () => !document.querySelector('#menu-bar-only-enabled').disabled);
  await page.evaluate(() => { workspaceFixture.failSettings = true; });
  await page.locator('#menu-bar-only-option .switch').click();
  await waitUntil(page, () => document.querySelector('#menu-bar-only-enabled').checked && !document.querySelector('#menu-bar-only-enabled').disabled);
  assert.equal(await page.evaluate(() => workspaceFixture.state.settings.menuBarOnly), true);
});

test('quick-panel navigation selects metadata and routes settings without fetching secrets', async page => {
  await page.evaluate(() => workspaceFixture.emit('workspace-navigation', { page: 'connections', itemId: 'api-build' }));
  await waitUntil(page, () => document.querySelector('#workspace-detail h2')?.textContent === 'Build API');
  assert.equal((await secretCalls(page)).length, 0);
  await page.evaluate(() => workspaceFixture.emit('workspace-navigation', { page: 'settings', section: 'APP' }));
  assert.equal(await page.locator('[data-settings-filter="APP"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('.settings-card[data-module="APP / 03"]').isVisible(), true);
  await page.evaluate(() => workspaceFixture.emit('workspace-navigation', { page: 'activity' }));
  assert.equal(await page.locator('#page-activity').isVisible(), true);
  assert.equal((await secretCalls(page)).length, 0);
  await assertNoSecretDOM(page);
});

let browser;
try {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
    args: ['--disable-background-networking', '--disable-component-update', '--no-first-run'],
  });
  for (const [index, scenario] of tests.entries()) {
    const started = Date.now();
    const fixture = createWorkspaceFixture(scenario.options);
    const context = await browser.newContext({ viewport: scenario.options.viewport || { width: 1200, height: 800 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.setDefaultTimeout(2500);
    page.setDefaultNavigationTimeout(10000);
    const errors = [];
    const blockedNetwork = [];
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', route => {
      if (new URL(route.request().url()).origin === origin) return route.continue();
      blockedNetwork.push(route.request().url());
      return route.abort('blockedbyclient');
    });
    await context.routeWebSocket('**/*', socket => {
      blockedNetwork.push(socket.url());
      socket.close();
    });
    await page.addInitScript(installWorkspaceFixture, fixture);
    const result = { name: scenario.name, ok: false };
    try {
      await page.goto(origin);
      await waitUntil(page, ({ language, total }) => document.documentElement.lang === (language === 'zh' ? 'zh-CN' : 'en') && document.querySelectorAll('#connections-list .connection-card').length === total && workspaceFixture.calls.some(call => call.command === 'get_state'), { language: fixture.state.settings.language, total: fixture.state.connections.length }, 'Renderer bootstrap must populate the synthetic fixture');
      await scenario.run(page);
      assert.deepEqual(errors, [], 'Renderer must not throw uncaught errors');
      assert.deepEqual(blockedNetwork, [], 'Renderer must not attempt external network access');
      assert.deepEqual(await page.evaluate(() => workspaceFixture.unexpectedCommands), [], 'Unexpected Tauri commands require an explicit synthetic fixture implementation');
      result.ok = true;
    } catch (error) {
      result.error = error.message;
      result.stack = error.stack;
      result.pageErrors = errors;
      result.blockedNetwork = blockedNetwork;
      result.unexpectedCommands = await page.evaluate(() => window.workspaceFixture?.unexpectedCommands || []).catch(() => []);
    } finally {
      const screenshot = `${String(index + 1).padStart(2, '0')}-${scenario.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`;
      await page.screenshot({ path: path.join(artifacts, screenshot), animations: 'disabled' }).then(() => { result.screenshot = screenshot; }).catch(error => { result.screenshotError = error.message; });
      result.durationMs = Date.now() - started;
      results.push(result);
      console.log(`${result.ok ? 'PASS' : 'FAIL'} ${result.name}${result.error ? `\n  ${result.error.split('\n').slice(0, 4).join('\n  ')}` : ''}`);
      await context.close();
    }
  }
} catch (error) {
  results.push({ name: 'workspace test harness', ok: false, error: error.message, stack: error.stack });
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}

const report = {
  ok: results.every(result => result.ok),
  passed: results.filter(result => result.ok).length,
  failed: results.filter(result => !result.ok).length,
  channel: process.env.PLAYWRIGHT_CHANNEL || 'chromium',
  isolation: 'Synthetic Tauri; immutable renderer snapshot; exact loopback origin only; service workers and WebSockets blocked',
  artifacts, source, fingerprints, results,
};
await fs.writeFile(path.join(artifacts, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ok: report.ok, passed: report.passed, failed: report.failed, artifacts, report: path.join(artifacts, 'report.json') }, null, 2));
if (!report.ok) process.exitCode = 1;
