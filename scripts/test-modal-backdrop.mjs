import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { chromium } from 'playwright';
import { createWorkspaceFixture, installWorkspaceFixture } from './fixtures/workspace.mjs';

// Synthetic renderer only: verifies pointer gesture ownership, no vault/native app.
const renderer = path.resolve(import.meta.dirname, '../renderer');
const output = await fs.mkdtemp(path.join(os.tmpdir(), 'keyhub-modal-backdrop-'));
const server = http.createServer(async (request, response) => {
  const file = path.resolve(renderer, `.${new URL(request.url, 'http://localhost').pathname === '/' ? '/index.html' : new URL(request.url, 'http://localhost').pathname}`);
  if (!file.startsWith(`${renderer}${path.sep}`)) { response.writeHead(403).end(); return; }
  try {
    response.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : file.endsWith('.png') ? 'image/png' : 'text/html');
    response.end(await fs.readFile(file));
  } catch { response.writeHead(404).end(); }
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
const fixture = createWorkspaceFixture({ language: 'zh', theme: 'light', empty: true });
const context = await browser.newContext({ viewport: { width: 1200, height: 800 }, reducedMotion: 'reduce' });
await context.addInitScript({ content: `(${installWorkspaceFixture.toString()})(${JSON.stringify(fixture)});
  const originalInvoke = window.__TAURI__.core.invoke;
  window.__TAURI__.core.invoke = async (command, args) => {
    if (command === 'github_backup_account') {
      if (workspaceFixture.holdGithub) await new Promise(resolve => { workspaceFixture.releaseGithub = resolve; });
      return { login: 'fixture-user' };
    }
    return originalInvoke(command, args);
  };` });
const page = await context.newPage();
page.setDefaultTimeout(2500);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const results = [];
const check = async (name, run) => {
  try { await run(); results.push({ name, ok: true }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, ok: false, error: error.message }); console.error(`FAIL ${name}: ${error.message}`); }
};
const press = async (selector, point = 'center') => {
  const box = await page.locator(selector).boundingBox();
  assert.ok(box, `${selector} must be visible`);
  const x = point === 'left' ? box.x + 4 : box.x + box.width / 2;
  const y = box.y + Math.min(12, box.height / 2);
  await page.mouse.move(x, y);
  await page.mouse.down();
  return { x, y };
};
const release = async point => { await page.mouse.move(point.x, point.y); await page.mouse.up(); };
const backdropPoint = async selector => {
  const box = await page.locator(selector).boundingBox();
  assert.ok(box);
  return { x: box.x + 8, y: box.y + box.height / 2 };
};
const expectHidden = async selector => page.locator(selector).waitFor({ state: 'hidden' });
const expectVisible = async selector => assert.equal(await page.locator(selector).isVisible(), true, `${selector} must remain visible`);

try {
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('#add-connection-button').waitFor();
  await page.evaluate(() => { window.fixture = workspaceFixture; });

  await check('input press then backdrop release keeps the credential editor open', async () => {
    await page.locator('#add-connection-button').click();
    await page.locator('#connection-modal').waitFor({ state: 'visible' });
    await page.locator('#connection-name').fill('Synthetic unsaved name');
    const saves = await page.evaluate(() => workspaceFixture.calls.filter(call => call.command === 'save_editor_draft').length);
    await press('#connection-name');
    await release(await backdropPoint('#connection-modal'));
    await page.waitForTimeout(60);
    await expectVisible('#connection-modal');
    assert.equal(await page.locator('#connection-name').inputValue(), 'Synthetic unsaved name');
    assert.equal(await page.evaluate(() => workspaceFixture.calls.filter(call => call.command === 'save_editor_draft').length), saves, 'Do not save/close a draft on a selection gesture');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'connection-name');
  });

  await check('backdrop press then input release keeps the credential editor open', async () => {
    if (!await page.locator('#connection-modal').isVisible()) await page.locator('#add-connection-button').click();
    const point = await backdropPoint('#connection-modal');
    await page.mouse.move(point.x, point.y); await page.mouse.down();
    const input = await page.locator('#connection-name').boundingBox();
    await release({ x: input.x + 20, y: input.y + 10 });
    await page.waitForTimeout(60);
    await expectVisible('#connection-modal');
  });

  await check('a complete backdrop gesture closes the credential editor', async () => {
    const point = await backdropPoint('#connection-modal');
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.up();
    await expectHidden('#connection-modal');
  });

  await check('selection outside the credential card does not close while dragging from its fields', async () => {
    await page.locator('#add-connection-button').click();
    await page.locator('#connection-name').fill('Synthetic gesture');
    const point = await press('#connection-name');
    await page.mouse.move(point.x + 250, point.y + 260, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(60);
    await expectVisible('#connection-modal');
    await page.locator('#connection-modal [data-close-modal]').first().click();
    await expectHidden('#connection-modal');
  });

  await check('confirmation backdrop requires both press and release', async () => {
    await page.evaluate(() => { void confirmDestructiveAction({ title: 'Synthetic', message: 'Synthetic', acceptLabel: 'OK' }); });
    await page.locator('#confirmation-modal').waitFor({ state: 'visible' });
    await press('#confirmation-cancel');
    await release(await backdropPoint('#confirmation-modal'));
    await expectVisible('#confirmation-modal');
    const point = await backdropPoint('#confirmation-modal');
    await page.mouse.move(point.x, point.y); await page.mouse.down(); await page.mouse.up();
    await expectHidden('#confirmation-modal');
  });

  await check('generator preserves its explicit-close policy for backdrop gestures', async () => {
    await page.evaluate(() => openGenerator());
    await page.locator('#generator-modal').waitFor({ state: 'visible' });
    await press('#generator-result');
    await release(await backdropPoint('#generator-modal'));
    await expectVisible('#generator-modal');
    const point = await backdropPoint('#generator-modal');
    await page.mouse.move(point.x, point.y); await page.mouse.down(); await page.mouse.up();
    await expectVisible('#generator-modal');
    await page.locator('#generator-close').click();
  });

  await check('backup password preserves its explicit-close policy for backdrop gestures', async () => {
    await page.evaluate(() => { void askBackupPassword(true); });
    await page.locator('#backup-password-modal').waitFor({ state: 'visible' });
    await press('#backup-password');
    await release(await backdropPoint('#backup-password-modal'));
    await expectVisible('#backup-password-modal');
    const point = await backdropPoint('#backup-password-modal');
    await page.mouse.move(point.x, point.y); await page.mouse.down(); await page.mouse.up();
    await expectVisible('#backup-password-modal');
    await page.locator('#backup-password-close').click();
  });

  await check('migration preserves its explicit-close policy for backdrop gestures', async () => {
    await page.locator('[data-page="settings"]').click();
    await page.locator('#migration-open').click();
    await page.locator('#migration-modal').waitFor({ state: 'visible' });
    await press('#migration-help');
    await release(await backdropPoint('#migration-modal'));
    await expectVisible('#migration-modal');
    const point = await backdropPoint('#migration-modal');
    await page.mouse.move(point.x, point.y); await page.mouse.down(); await page.mouse.up();
    await expectVisible('#migration-modal');
    await page.locator('#migration-close').click();
  });

  await check('vault management preserves its explicit-close policy for backdrop gestures', async () => {
    await page.locator('#trash-open').click();
    await page.locator('#vault-management-modal').waitFor({ state: 'visible' });
    await press('#vault-management-help');
    await release(await backdropPoint('#vault-management-modal'));
    await expectVisible('#vault-management-modal');
    const point = await backdropPoint('#vault-management-modal');
    await page.mouse.move(point.x, point.y); await page.mouse.down(); await page.mouse.up();
    await expectVisible('#vault-management-modal');
    await page.locator('#vault-management-close').click();
  });

  await check('GitHub modal has the same complete-gesture ownership', async () => {
    await page.locator('[data-page="settings"]').click();
    await page.locator('#github-connect').click();
    await page.locator('#github-modal').waitFor({ state: 'visible' });
    await press('#github-repository');
    await release(await backdropPoint('#github-modal'));
    await expectVisible('#github-modal');
    const point = await backdropPoint('#github-modal');
    await page.mouse.move(point.x, point.y); await page.mouse.down(); await page.mouse.up();
    await expectHidden('#github-modal');
  });

  await check('a busy GitHub modal cannot be dismissed by a complete backdrop gesture', async () => {
    await page.locator('#github-connect').click();
    await page.locator('#github-modal').waitFor({ state: 'visible' });
    await page.evaluate(() => { workspaceFixture.holdGithub = true; });
    await page.locator('#github-check-account').click();
    await page.waitForFunction(() => typeof workspaceFixture.releaseGithub === 'function');
    assert.equal(await page.locator('#github-check-account').isDisabled(), true);
    const point = await backdropPoint('#github-modal');
    await page.mouse.move(point.x, point.y); await page.mouse.down(); await page.mouse.up();
    await expectVisible('#github-modal');
    await page.evaluate(() => { workspaceFixture.holdGithub = false; workspaceFixture.releaseGithub(); });
    await page.waitForFunction(() => !document.querySelector('#github-check-account').disabled);
    await page.locator('#github-modal-close').click();
  });

  await check('right-button, non-primary and canceled gestures cannot dismiss', async () => {
    await page.locator('[data-page="connections"]').click();
    await page.locator('#add-connection-button').click();
    await page.locator('#connection-modal').waitFor({ state: 'visible' });
    const point = await backdropPoint('#connection-modal');
    await page.mouse.move(point.x, point.y); await page.mouse.down({ button: 'right' }); await page.mouse.up({ button: 'right' });
    await expectVisible('#connection-modal');
    await page.locator('#connection-modal').dispatchEvent('pointerdown', { button: 0, isPrimary: false, pointerId: 77, clientX: 10, clientY: 10 });
    await page.locator('#connection-modal').dispatchEvent('pointerup', { button: 0, isPrimary: false, pointerId: 77, clientX: 10, clientY: 10 });
    await expectVisible('#connection-modal');
    await page.mouse.move(point.x, point.y); await page.mouse.down();
    await page.locator('#connection-modal').dispatchEvent('pointercancel', { pointerId: 1 });
    await page.mouse.up();
    await expectVisible('#connection-modal');
    await page.locator('#connection-modal [data-close-modal]').first().click();
  });

  await check('drag exceeding three pixels on the backdrop does not dismiss', async () => {
    await page.locator('#add-connection-button').click();
    await page.locator('#connection-modal').waitFor({ state: 'visible' });
    const point = await backdropPoint('#connection-modal');
    await page.mouse.move(point.x, point.y); await page.mouse.down();
    await page.mouse.move(point.x + 9, point.y, { steps: 3 });
    await page.mouse.up();
    await expectVisible('#connection-modal');
    await page.locator('#connection-modal [data-close-modal]').first().click();
  });

  await check('a canceled backdrop drag stays canceled after returning to its starting point', async () => {
    await page.locator('#add-connection-button').click();
    const point = await backdropPoint('#connection-modal');
    await page.mouse.move(point.x, point.y); await page.mouse.down();
    await page.mouse.move(point.x + 15, point.y, { steps: 3 });
    await page.mouse.move(point.x, point.y, { steps: 3 }); await page.mouse.up();
    await expectVisible('#connection-modal');
    await page.locator('#connection-modal [data-close-modal]').first().click();
  });

  await check('closing on the click phase cannot activate a control underneath the backdrop', async () => {
    await page.locator('#add-connection-button').click();
    const point = await backdropPoint('#connection-modal');
    await page.evaluate(({ x, y }) => {
      const button = document.createElement('button');
      button.id = 'under-backdrop'; button.type = 'button'; button.textContent = 'Synthetic underlying action';
      button.style.cssText = `position:fixed;left:${x - 5}px;top:${y - 5}px;width:20px;height:20px;z-index:90`;
      button.onclick = () => { workspaceFixture.underlyingClicks = (workspaceFixture.underlyingClicks || 0) + 1; };
      document.body.append(button);
      workspaceFixture.modalVisibleAtPointerUp = null;
      document.addEventListener('pointerup', () => {
        workspaceFixture.modalVisibleAtPointerUp = !document.querySelector('#connection-modal').classList.contains('hidden');
      }, { once: true });
    }, point);
    await page.mouse.move(point.x, point.y); await page.mouse.down(); await page.mouse.up();
    await expectHidden('#connection-modal');
    assert.equal(await page.evaluate(() => workspaceFixture.modalVisibleAtPointerUp), true, 'Do not remove the dialog until click');
    assert.equal(await page.evaluate(() => workspaceFixture.underlyingClicks || 0), 0);
    await page.locator('#under-backdrop').evaluate(element => element.remove());
  });

  await check('blur and pointer capture cancellation invalidate an unfinished backdrop press', async () => {
    for (const type of ['blur', 'lostpointercapture']) {
      await page.locator('#add-connection-button').click();
      const point = await backdropPoint('#connection-modal');
      await page.mouse.move(point.x, point.y); await page.mouse.down();
      if (type === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      else await page.locator('#connection-modal').dispatchEvent('lostpointercapture', { pointerId: 1 });
      await page.mouse.up();
      await expectVisible('#connection-modal');
      await page.locator('#connection-modal [data-close-modal]').first().click();
    }
  });

  await check('nested confirmation drag cannot cancel it or close the underlying editor', async () => {
    await page.locator('#add-connection-button').click();
    await page.evaluate(() => { void confirmDestructiveAction({ title: 'Nested synthetic', message: 'Synthetic', acceptLabel: 'OK' }); });
    await page.locator('#confirmation-modal').waitFor({ state: 'visible' });
    await press('#confirmation-message');
    await release(await backdropPoint('#confirmation-modal'));
    await expectVisible('#confirmation-modal');
    await expectVisible('#connection-modal');
    await page.locator('#confirmation-cancel').click();
    await expectHidden('#confirmation-modal');
    await expectVisible('#connection-modal');
    await page.keyboard.press('Escape');
    await expectHidden('#connection-modal');
  });

  await check('implicit touch capture loss after release preserves a complete backdrop click', async () => {
    await page.locator('#add-connection-button').click();
    const point = await backdropPoint('#connection-modal');
    for (const type of ['pointerdown', 'pointerup', 'lostpointercapture']) {
      await page.locator('#connection-modal').dispatchEvent(type, { pointerId: 99, pointerType: 'touch', button: 0, isPrimary: true, clientX: point.x, clientY: point.y });
    }
    await page.locator('#connection-modal').dispatchEvent('click', { pointerId: 99, pointerType: 'touch', detail: 1, button: 0 });
    await expectHidden('#connection-modal');
  });

  assert.deepEqual(errors, []);
  assert.ok(results.every(result => result.ok), JSON.stringify(results, null, 2));
  await fs.writeFile(path.join(output, 'report.json'), `${JSON.stringify({ results, errors }, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, checks: results.length, artifacts: output }, null, 2));
} finally {
  await browser.close();
  server.close();
}
