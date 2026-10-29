// Real binaries, isolated temporary vaults and loopback only. No GUI or user config.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const repo = path.resolve(import.meta.dirname, '..');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'keyhub-cli-test-'));
const binaryRoot = process.env.KEYHUB_TEST_BIN_DIR || path.join(repo, 'src-tauri/target/debug');
const extension = process.platform === 'win32' ? '.exe' : '';
const env = { ...process.env };
for (const name of ['KEYHUB_DATA_DIR', 'OPENKEYLET_DATA_DIR', 'KRU_DATA_DIR', 'KEYHUB_LAUNCHER_PATH', 'OPENKEYLET_LAUNCHER_PATH', 'KRU_LAUNCHER_PATH', 'APPIMAGE']) delete env[name];
const expectedTools = ['credential_fill', 'http_send', 'items_create', 'items_search', 'ssh_download', 'ssh_run', 'ssh_upload', 'terminal_read', 'terminal_run', 'terminal_start', 'terminal_stop', 'terminal_write'];
async function smoke(name, variable) {
  const data = path.join(root, `${name}-data`);
  const command = path.join(binaryRoot, name + extension);
  const child = spawn(command, ['mcp', 'stdio'], { env: { ...env, [variable]: data }, stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = '', stderr = '', next = 1;
  const pending = new Map();
  child.stderr.on('data', data => { stderr += data; });
  child.on('error', error => { for (const wait of pending.values()) wait.reject(error); });
  child.stdout.on('data', data => {
    buffer += data;
    for (let end; (end = buffer.indexOf('\n')) >= 0;) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      if (!line.trim()) continue;
      const message = JSON.parse(line), wait = pending.get(message.id);
      if (wait) { pending.delete(message.id); message.error ? wait.reject(Error(JSON.stringify(message.error))) : wait.resolve(message.result); }
    }
  });
  function request(method, params) {
    const id = next++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(Error(`${name}: ${method} timed out`)); }, 15000);
      pending.set(id, { resolve: result => { clearTimeout(timer); resolve(result); }, reject: error => { clearTimeout(timer); reject(error); } });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }
  try {
    const info = await request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'keyhub-compatibility-test', version: '1' } });
    assert.equal(info.serverInfo.name, 'keyhub'); assert.equal(info.serverInfo.title, 'KeyHub');
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const tools = await request('tools/list', {});
    assert.deepEqual(tools.tools.map(tool => tool.name).sort(), expectedTools);
    assert.ok(tools.tools.every(tool => tool.outputSchema && tool.annotations));
    const createSchema = tools.tools.find(tool => tool.name === 'items_create').inputSchema;
    assert.ok(createSchema.properties.name && createSchema.properties.modules);
    assert.equal(createSchema.additionalProperties, false);
    for (const argumentsValue of [
      { name: 'ASR', modules: 'secret-marker-never-echo-7391' },
      { name: 'ASR', modules: [{ kind: 'apiCredential', value: 'secret-marker-never-echo-7391' }] },
    ]) {
      let rejected;
      try { rejected = await request('tools/call', { name: 'items_create', arguments: argumentsValue }); }
      catch (error) { rejected = { error: error.message }; }
      assert.ok(rejected.isError || rejected.error, 'secret-bearing invalid input must fail');
      assert.ok(!JSON.stringify(rejected).includes('secret-marker-never-echo-7391'));
    }
    const search = await request('tools/call', { name: 'items_search', arguments: {} });
    assert.notEqual(search.isError, true); assert.deepEqual(search.structuredContent.items, []);
    const created = await request('tools/call', { name: 'items_create', arguments: {
      name: 'ASR test fixture', description: 'Synthetic transcription service',
      modules: [{ kind: 'url', value: 'https://asr.example.test/v1' }, { kind: 'apiCredential' }],
    } });
    assert.notEqual(created.isError, true);
    assert.equal(created.structuredContent.created, true);
    assert.equal(created.structuredContent.requiresOwnerInput, true);
    assert.deepEqual(created.structuredContent.missingFields, ['apiCredential']);
    const duplicate = await request('tools/call', { name: 'items_create', arguments: {
      name: 'ASR test fixture', modules: [{ kind: 'apiCredential' }],
    } });
    assert.equal(duplicate.isError, true);
    const pendingItem = await request('tools/call', { name: 'items_search', arguments: { query: 'ASR test fixture' } });
    assert.equal(pendingItem.structuredContent.items.length, 1);
    assert.deepEqual(pendingItem.structuredContent.items[0].actions, []);
    assert.equal(pendingItem.structuredContent.items[0].modules.find(module => module.kind === 'apiCredential').configured, false);
    const run = await request('tools/call', { name: 'terminal_run', arguments: { command: 'printf keyhub-cli-ok' } });
    assert.notEqual(run.isError, true); assert.ok(JSON.stringify(run.structuredContent).includes('keyhub-cli-ok'));
  } finally {
    child.stdin.end();
    await new Promise(resolve => { child.once('exit', resolve); setTimeout(() => { child.kill('SIGTERM'); resolve(); }, 1500).unref(); });
  }
  const config = spawnSync(command, ['config', 'stdio-json'], { env: { ...env, [variable]: data }, encoding: 'utf8', timeout: 15000 });
  assert.equal(config.status, 0, config.stderr);
  assert.ok(JSON.parse(config.stdout).mcpServers.keyhub);
  assert.equal(JSON.parse(await fs.readFile(path.join(data, 'vault.json'), 'utf8')).version, 12);
  assert.equal(stderr, '');
  return { binary: name, override: variable, tools: expectedTools.length, config: 'keyhub', vaultVersion: 12 };
}
const checks = [];
for (const [name, variable] of [['keyhub', 'KEYHUB_DATA_DIR'], ['openkeylet', 'OPENKEYLET_DATA_DIR'], ['kru', 'KRU_DATA_DIR']]) checks.push(await smoke(name, variable));
console.log(JSON.stringify({ ok: true, checks, root }, null, 2));
