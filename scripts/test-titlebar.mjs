import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const lock = await readFile(new URL('../src-tauri/Cargo.lock', import.meta.url), 'utf8');
const version = lock.match(/name = "tauri"\nversion = "([^"]+)"/)[1];
const registry = path.join(process.env.CARGO_HOME || path.join(homedir(), '.cargo'), 'registry/src');
let nativeSource;
for (const entry of await readdir(registry)) {
  try {
    nativeSource = await readFile(path.join(registry, entry, `tauri-${version}/src/window/scripts/drag.js`), 'utf8');
    break;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
assert.ok(nativeSource, `Installed Tauri ${version} drag.js is required`);
const source = process.argv.includes('--native-baseline')
  ? 'window.KeyHubTitlebar = { install() {} };'
  : await readFile(new URL('../renderer/titlebar.js', import.meta.url), 'utf8');
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
let passed = 0;
try {
  for (const isMacOS of [true, false]) {
    const page = await browser.newPage();
    await page.setContent(`<div id="title" data-tauri-drag-region="deep">
      <span id="text">KeyHub <svg id="logo"><path id="path" d="M0 0h10v10z" /></svg></span>
      <button id="button"><span id="button-child">Close</span></button>
      ${['input', 'select', 'textarea', 'a', 'label', 'summary'].map(tag => `<${tag} id="${tag}"></${tag}>`).join('')}
      <span id="editable" contenteditable><span id="editable-child">Edit</span></span>
      <span id="disabled" data-tauri-drag-region="false"><span id="disabled-child">No</span></span>
      <span id="tabindex" tabindex="0">Focus</span>
      ${['button', 'link', 'menuitem', 'tab', 'checkbox', 'radio', 'switch', 'option', 'textbox', 'slider', 'combobox', 'listbox', 'spinbutton', 'searchbox', 'treeitem'].map(role => `<span id="role-${role}" role="${role}">Control</span>`).join('')}
    </div><div id="outside">Outside</div>`);
    await page.evaluate(() => {
      window.calls = [];
      window.errors = [];
      window.__TAURI_INTERNALS__ = { invoke: command => { window.calls.push([command]); return Promise.resolve(); } };
    });
    await page.addScriptTag({ content: nativeSource.replace('__TEMPLATE_os_name__', JSON.stringify(isMacOS ? 'macos' : 'windows')) });
    await page.addScriptTag({ content: source });
    await page.evaluate(isMacOS => {
      window.KeyHubTitlebar.install({
        element: document.querySelector('#title'), isMacOS,
        invoke: (...args) => {
          window.calls.push(args);
          if (window.failure === 'throw') throw new Error('sync failure');
          if (window.failure === 'reject') return Promise.reject(new Error('async failure'));
          if (window.hold) return new Promise(resolve => { window.release = resolve; });
          return Promise.resolve();
        },
        onError: error => window.errors.push(error.message),
      });
      window.fire = (type, target = 'text', options = {}) => {
        const event = new MouseEvent(type, { bubbles: true, cancelable: true, composed: true,
          button: 0, detail: 2, clientX: 20, clientY: 20, screenX: 100, screenY: 100, ...options });
        document.getElementById(target).dispatchEvent(event);
        return event.defaultPrevented;
      };
      window.double = (target = 'text', options = {}) => {
        window.fire('mousedown', target, options);
        window.fire('mouseup', target, options);
        window.fire('dblclick', target, options);
      };
    }, isMacOS);
    const check = async (name, run, expected) => {
      await page.evaluate(() => { window.calls = []; });
      const result = await page.evaluate(run);
      assert.deepEqual(await page.evaluate(() => window.calls), expected, name);
      passed++;
      return result;
    };
    const custom = [['window_action', { action: 'maximize' }]];
    const native = [['plugin:window|internal_toggle_maximize']];
    await check('first click retains native start_dragging', () => {
      window.fire('mousedown', 'text', { detail: 1 });
      window.fire('mouseup', 'text', { detail: 1 });
    }, [['plugin:window|start_dragging']]);
    await check('double click invokes only one maximize', () => window.double(), isMacOS ? custom : native);
    if (!isMacOS) {
      assert.equal(await check('non-mac selection untouched', () => window.fire('selectstart'), []), false);
      await page.close();
      continue;
    }
    for (const target of ['title', 'text', 'logo', 'path']) {
      await page.evaluate(() => { window.calls = []; });
      await page.evaluate(target => window.double(target), target);
      assert.deepEqual(await page.evaluate(() => window.calls), custom, target);
      passed++;
    }
    const controls = await page.locator('#title button, #title input, #title select, #title textarea, #title a, #title label, #title summary, #title [contenteditable], #title [role], #tabindex, #disabled, #disabled-child, #button-child, #editable-child').evaluateAll(nodes => nodes.map(node => node.id));
    for (const target of controls) {
      await page.evaluate(target => {
        window.calls = [];
        window.untouched = ['mousedown', 'mouseup', 'selectstart', 'dragstart'].map(type => !window.fire(type, target));
      }, target);
      const calls = await page.evaluate(() => window.calls);
      const nativeUnblockedRoles = ['textbox', 'slider', 'combobox', 'listbox', 'spinbutton', 'searchbox', 'treeitem'];
      assert.deepEqual(calls, nativeUnblockedRoles.some(role => target === `role-${role}`) ? native : [], target);
      assert.ok((await page.evaluate(() => window.untouched)).every(Boolean), target);
      passed++;
    }
    for (const options of [{ button: 2 }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }, { detail: 3 }]) {
      await page.evaluate(options => { window.calls = []; window.double('text', options); }, options);
      const calls = await page.evaluate(() => window.calls);
      assert.deepEqual(calls, Object.keys(options).some(key => key.endsWith('Key')) ? native : []);
      passed++;
    }
    assert.equal(await page.evaluate(() => window.fire('selectstart')), true);
    assert.equal(await page.evaluate(() => window.fire('dragstart')), true);
    await check('movement in client coordinates cancels even after returning', () => {
      window.fire('mousedown'); window.fire('mousemove', 'outside', { clientX: 24 }); window.fire('mouseup');
    }, []);
    await check('screen movement cancels', () => {
      window.fire('mousedown'); window.fire('mouseup', 'text', { screenX: 104 });
    }, []);
    await check('screen movement cancels even after returning', () => {
      window.fire('mousedown'); window.fire('mousemove', 'text', { screenY: 104 }); window.fire('mouseup');
    }, []);
    await check('client release movement cancels', () => {
      window.fire('mousedown'); window.fire('mouseup', 'text', { clientY: 24 });
    }, []);
    await check('three pixel tolerance', () => {
      window.fire('mousedown'); window.fire('mouseup', 'text', { clientX: 23, screenX: 103 });
    }, custom);
    for (const cancellation of ['blur', 'pointercancel', 'outside', 'control', 'modifier']) {
      await page.evaluate(cancellation => {
        window.calls = []; window.fire('mousedown');
        if (cancellation === 'blur') window.dispatchEvent(new Event('blur'));
        if (cancellation === 'pointercancel') document.dispatchEvent(new Event('pointercancel'));
        if (cancellation === 'outside') window.fire('mouseup', 'outside');
        if (cancellation === 'control') window.fire('mouseup', 'button');
        if (cancellation === 'modifier') window.fire('mouseup', 'text', { shiftKey: true });
        window.fire('mouseup');
      }, cancellation);
      assert.deepEqual(await page.evaluate(() => window.calls), cancellation === 'modifier' ? native : [], cancellation);
      passed++;
    }
    await check('orphan release cannot use native stale state', () => window.fire('mouseup'), []);
    await check('rapid repeated clicks singleflight', () => {
      window.hold = true; window.double(); window.double(); window.double();
    }, custom);
    await page.evaluate(async () => { window.release(); await Promise.resolve(); window.hold = false; });
    await check('singleflight releases after success', () => window.double(), custom);
    for (const failure of ['throw', 'reject']) {
      await page.evaluate(failure => { window.failure = failure; window.double(); }, failure);
      await page.evaluate(() => { window.failure = null; });
      await check(`recovers after ${failure}`, () => window.double(), custom);
    }
    assert.deepEqual(await page.evaluate(() => window.errors), ['sync failure', 'async failure']);
    await page.close();
  }
  console.log(`PASS: ${passed} titlebar checks with installed Tauri ${version} drag.js (no native app/vault)`);
} finally {
  await browser.close();
}
