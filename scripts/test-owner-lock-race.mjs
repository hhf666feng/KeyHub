import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const source = await fs.readFile(new URL('../renderer/app.js', import.meta.url), 'utf8');
const functionSource = (name) => {
  const match = source.match(new RegExp(`^(?:async )?function ${name}\\([^]*?^}`, 'm'));
  assert.ok(match, `Missing renderer function: ${name}`);
  return match[0];
};
const deferred = () => {
  let resolve;
  const promise = new Promise((complete) => { resolve = complete; });
  return { promise, resolve };
};

function fixture() {
  const elements = new Map();
  const element = (selector) => {
    if (!elements.has(selector)) {
      const classes = new Set(['hidden']);
      elements.set(selector, {
        classList: {
          contains: (name) => classes.has(name),
          add: (name) => classes.add(name),
          remove: (name) => classes.delete(name),
          toggle: (name, force) => force ? classes.add(name) : classes.delete(name),
        },
        focus() {}, contains() { return false; },
      });
    }
    return elements.get(selector);
  };
  const context = vm.createContext({
    api: {}, $: element, $$: () => [], document: { activeElement: null },
    setTimeout() {}, requestAnimationFrame() {},
    localized: (_zh, en) => en, toast() {}, cleanError: String,
    pinInputs: () => [], clearPin() {}, focusPin() {},
    closeVaultManagement() {}, closeMigration() {}, closeGenerator() {}, finishBackupPassword() {},
    clearOwnerPlaintext() { vm.runInContext('currentModules = [];', context); element('#connection-modal').classList.add('hidden'); },
    renderDrafts() {}, renderConnections() {}, closeEditorWithDraft: async () => true,
    draftSecretValues: (secrets) => secrets || {}, value() {}, typeOptions: () => '',
    renderLoginUris() {}, updateEditorTitle() {}, defaultModuleAgentVisible: () => false,
    renderModules() {}, placeItemEditor() {}, serializeItem: () => ({}),
    animateInlineEditor: async () => false,
    readPin: () => '123456', renderMetrics() {}, renderSettings() {},
    githubBackup: { refresh: async () => {} },
  });
  const generations = source.match(/^let (?:privateReadEpoch|ownerStateGeneration) = .*;$/gm) || [];
  vm.runInContext(`
    let ownerLockState = { pinConfigured: true, unlocked: true };
    ${generations.join('\n')}
    let ownerPinSetupRequested = false, workspaceSelectedId = null;
    let editorDrafts = [], currentModules = [], editorOpening = false, inlineEditorItemId = null;
    let removedSecretFields, editorExistingItem, editorSourceInput, editorOpenedFromDraft;
    let currentDraftId, editorReturnFocus, editorInitialSnapshot;
    const state = { connections: [] };
    function closeAgentUsage() {}
    ${['renderOwnerLock', 'refreshOwnerLock', 'lockOwner', 'refreshDrafts', 'openEditor'].map(functionSource).join('\n')}
  `, context);
  const unlockHandler = source.match(/\$\('#owner-lock-form'\)\.addEventListener\('submit', (async \(event\) => \{[^]*?^})\);/m);
  assert.ok(unlockHandler, 'Missing owner unlock handler');
  vm.runInContext(`const unlockOwner = ${unlockHandler[1]};`, context);
  return {
    context, element,
    run: (code) => vm.runInContext(code, context),
    lock: () => vm.runInContext('ownerLockState = { pinConfigured: true, unlocked: false }; renderOwnerLock();', context),
  };
}

test('late drafts cannot repopulate after lock, including a subsequent unlock', async () => {
  for (const unlockAgain of [false, true]) {
    const harness = fixture();
    const read = deferred();
    harness.context.api.drafts = () => read.promise;
    const pending = harness.run('refreshDrafts()');
    harness.lock();
    if (unlockAgain) harness.run('ownerLockState.unlocked = true; renderOwnerLock();');
    read.resolve([{ id: 'private-draft', input: { secrets: { password: 'secret' } } }]);
    await pending;
    assert.equal(harness.run('editorDrafts.length'), 0);
  }
});

test('late editor secrets cannot reopen or repopulate after lock', async () => {
  for (const unlockAgain of [false, true]) {
    const harness = fixture();
    const read = deferred();
    harness.context.api.ownerSecrets = () => read.promise;
    const pending = harness.run("openEditor({ id: 'item', modules: [{ kind: 'password' }] })");
    harness.lock();
    if (unlockAgain) harness.run('ownerLockState.unlocked = true; renderOwnerLock();');
    read.resolve({ fields: [{ name: 'password', value: 'secret' }] });
    assert.equal(await pending, false);
    assert.equal(harness.run('currentModules.length'), 0);
    assert.equal(harness.element('#connection-modal').classList.contains('hidden'), true);
    assert.equal(harness.run('editorOpening'), false);
  }
});

test('older unlocked status cannot override a newer locked status', async () => {
  const harness = fixture();
  const older = deferred();
  const newer = deferred();
  harness.context.api.ownerStatus = () => older.promise;
  const first = harness.run('refreshOwnerLock()');
  harness.context.api.ownerStatus = () => newer.promise;
  const second = harness.run('refreshOwnerLock()');
  newer.resolve({ pinConfigured: true, unlocked: false });
  await second;
  older.resolve({ pinConfigured: true, unlocked: true });
  await first;
  assert.equal(harness.run('ownerLockState.unlocked'), false);
});

test('lock immediately clears private state and invalidates pending status', async () => {
  const harness = fixture();
  const status = deferred();
  const lock = deferred();
  harness.context.api.ownerStatus = () => status.promise;
  harness.context.api.ownerLock = () => lock.promise;
  harness.run("editorDrafts = [{ id: 'existing-draft' }];");
  const reading = harness.run('refreshOwnerLock()');
  const locking = harness.run('lockOwner()');
  assert.equal(harness.run('editorDrafts.length'), 0);
  status.resolve({ pinConfigured: true, unlocked: true });
  await reading;
  assert.equal(harness.run('ownerLockState.unlocked'), false);
  lock.resolve({ pinConfigured: true, unlocked: false });
  await locking;
});

test('ordinary refresh preserves drafts and normal secret editing works', async () => {
  const harness = fixture();
  harness.context.api.drafts = async () => [{ id: 'saved-draft', input: { secrets: { password: 'draft-secret' } } }];
  harness.context.api.ownerStatus = async () => ({ pinConfigured: true, unlocked: true });
  harness.context.api.ownerSecrets = async () => ({ fields: [{ name: 'password', value: 'secret' }] });
  await harness.run('refreshDrafts();');
  await harness.run('refreshOwnerLock();');
  assert.equal(harness.run('editorDrafts[0].input.secrets.password'), 'draft-secret');
  assert.equal(await harness.run("openEditor({ id: 'item', modules: [{ kind: 'password' }] })"), true);
  assert.equal(harness.run('currentModules[0].secretValue'), 'secret');
});

test('late unlock response cannot undo a lock notification', async () => {
  const harness = fixture();
  harness.lock();
  const unlock = deferred();
  harness.context.api.ownerUnlock = () => unlock.promise;
  const pending = harness.run('unlockOwner({ preventDefault() {} })');
  harness.lock();
  unlock.resolve({ pinConfigured: true, unlocked: true });
  await pending;
  assert.equal(harness.run('ownerLockState.unlocked'), false);
  assert.equal(harness.run('editorDrafts.length'), 0);
});

test('ordinary unlock loads saved drafts', async () => {
  const harness = fixture();
  harness.lock();
  harness.context.api.ownerUnlock = async () => ({ pinConfigured: true, unlocked: true });
  harness.context.api.drafts = async () => [{ id: 'preserved-draft' }];
  await harness.run('unlockOwner({ preventDefault() {} })');
  assert.equal(harness.run('ownerLockState.unlocked'), true);
  assert.equal(harness.run('editorDrafts[0].id'), 'preserved-draft');
});

test('status refresh without revocation does not discard an in-flight draft read', async () => {
  const harness = fixture();
  const read = deferred();
  harness.context.api.drafts = () => read.promise;
  harness.context.api.ownerStatus = async () => ({ pinConfigured: true, unlocked: true });
  const pending = harness.run('refreshDrafts()');
  await harness.run('refreshOwnerLock()');
  read.resolve([{ id: 'preserved-draft' }]);
  await pending;
  assert.equal(harness.run('editorDrafts[0].id'), 'preserved-draft');
});

test('lock notification refreshes owner status before state and drafts', () => {
  assert.match(source, /event\.listen\('state-changed', async \(\) => \{ await refreshOwnerLock\(false\); await refresh\(false\); await refreshDrafts\(\); \}\)/);
});
