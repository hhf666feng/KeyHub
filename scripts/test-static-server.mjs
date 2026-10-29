import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { startStaticServer } from './fixtures/static-server.mjs';

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'keyhub-static-server-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'site');
  await fs.mkdir(path.join(root, 'nested'), { recursive: true });
  for (const name of ['index.html', 'app.js', 'style.css', 'mark.svg', 'mark.png', 'file.bin', 'nested/file name.js']) {
    await fs.writeFile(path.join(root, name), `fixture: ${name}`);
  }
  await fs.writeFile(path.join(directory, 'secret.txt'), 'outside root');
  await fs.mkdir(path.join(directory, 'site-sibling'));
  await fs.writeFile(path.join(directory, 'site-sibling', 'secret.txt'), 'prefix sibling');
  await fs.symlink(path.join(directory, 'secret.txt'), path.join(root, 'escape.txt'));
  const server = await startStaticServer(root);
  t.after(() => server.close());
  return server;
}

// Keep raw request paths: fetch/URL normalize dot segments before sending them.
function request(server, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get(server.url, { path: pathname, agent: false }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body }));
    });
    req.on('error', reject);
    req.setTimeout(2000, () => req.destroy(new Error('Fixture request timed out')));
  });
}

test('binds an ephemeral loopback port and serves index.html at root', async t => {
  const server = await fixture(t);
  const url = new URL(server.url);
  assert.equal(url.hostname, '127.0.0.1');
  assert.ok(Number(url.port) > 0);
  const response = await request(server, '/?fixture=1');
  assert.equal(response.status, 200);
  assert.equal(response.body, 'fixture: index.html');
});

test('preserves fixture content types and serves nested encoded filenames', async t => {
  const server = await fixture(t);
  for (const [filename, type] of Object.entries({
    'index.html': 'text/html', 'app.js': 'text/javascript', 'style.css': 'text/css',
    'mark.svg': 'image/svg+xml', 'mark.png': 'image/png', 'file.bin': 'application/octet-stream',
    'nested/file%20name.js': 'text/javascript',
  })) {
    const response = await request(server, `/${filename}`);
    assert.equal(response.status, 200, filename);
    assert.equal(response.headers['content-type'], type, filename);
    assert.equal(response.body, `fixture: ${decodeURIComponent(filename)}`);
  }
});

test('returns 404 for missing files and directories without stopping the server', async t => {
  const server = await fixture(t);
  for (const pathname of ['/missing.js', '/nested/']) {
    assert.equal((await request(server, pathname)).status, 404, pathname);
  }
  assert.equal((await request(server, '/')).status, 200);
});

test('rejects traversal, sibling-prefix and symlink escapes with 403', async t => {
  const server = await fixture(t);
  for (const pathname of [
    '/../secret.txt', '/nested/../../secret.txt', '/../site-sibling/secret.txt',
    '/%2e%2e/secret.txt', '/%2E%2E%2Fsite-sibling/secret.txt',
    '/nested/%2e%2e/%2e%2e/secret.txt', '/..%5csecret.txt', '/escape.txt',
  ]) {
    const response = await request(server, pathname);
    assert.equal(response.status, 403, pathname);
    assert.doesNotMatch(response.body, /outside root|prefix sibling/);
  }
});

test('returns 400 for malformed request targets and remains usable', async t => {
  const server = await fixture(t);
  for (const pathname of ['/%', '/%E0%A4%A', '/%00', '//[invalid']) {
    assert.equal((await request(server, pathname)).status, 400, pathname);
  }
  assert.equal((await request(server, '/')).status, 200);
});

test('explicit cleanup is bounded with an unfinished connection and is repeatable', { timeout: 3000 }, async t => {
  const server = await fixture(t);
  const url = new URL(server.url);
  const socket = net.connect({ host: url.hostname, port: Number(url.port) });
  socket.on('error', error => assert.equal(error.code, 'ECONNRESET'));
  t.after(() => socket.destroy());
  await once(socket, 'connect');
  socket.write('GET / HTTP/1.1\r\nHost: localhost\r\n');
  await server.close();
  await server.close();
  await assert.rejects(request(server, '/'), { code: 'ECONNREFUSED' });
});
