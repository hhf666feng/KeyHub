import { once } from 'node:events';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

const contentTypes = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

export async function startStaticServer(directory) {
  const root = await fs.realpath(directory);
  const outsideRoot = file => {
    const relative = path.relative(root, file);
    return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
  };
  const server = http.createServer(async (request, response) => {
    let pathname;
    try {
      // Inspect raw dot segments before URL normalization can hide traversal.
      if (!request.url?.startsWith('/') || request.url.startsWith('//')) throw new Error('Invalid target');
      pathname = decodeURIComponent(request.url.split(/[?#]/, 1)[0]);
      if (pathname.includes('\0')) throw new Error('Invalid target');
    } catch {
      response.writeHead(400).end();
      return;
    }
    if (pathname.includes('\\') || pathname.split('/').includes('..')) {
      response.writeHead(403).end();
      return;
    }
    const file = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (outsideRoot(file)) {
      response.writeHead(403).end();
      return;
    }
    try {
      const resolved = await fs.realpath(file);
      if (outsideRoot(resolved)) {
        response.writeHead(403).end();
        return;
      }
      if (!(await fs.stat(resolved)).isFile()) {
        response.writeHead(404).end();
        return;
      }
      const content = await fs.readFile(resolved);
      response.setHeader('Content-Type', contentTypes[path.extname(file)] || 'application/octet-stream');
      response.end(content);
    } catch {
      response.writeHead(404).end();
    }
  });
  const sockets = new Set();
  server.on('connection', socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  let closing;
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close() {
      if (!closing) {
        closing = new Promise((resolve, reject) => {
          server.close(error => error ? reject(error) : resolve());
          // Fixture teardown must not wait for keep-alive or partial requests.
          for (const socket of sockets) socket.destroy();
        });
      }
      return closing;
    },
  };
}
