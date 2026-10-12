import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

const root = resolve('app'),
  headers = JSON.parse(await readFile('security-headers.json', 'utf8'));
const port = Number(process.env.VAFX_PREVIEW_PORT ?? 5184);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('Choose a VAFX_PREVIEW_PORT from 1024 to 65535.');
const mime = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json',
  wasm: 'application/wasm',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  txt: 'text/plain; charset=utf-8',
  zip: 'application/zip',
};
const server = createServer(async (request, response) => {
  try {
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, headers);
      response.end();
      return;
    }
    const url = new URL(request.url, 'http://127.0.0.1'),
      path = resolve(
        root,
        `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`,
      );
    if (!path.startsWith(root + sep)) {
      response.writeHead(403, headers);
      response.end();
      return;
    }
    const bytes = await readFile(path);
    response.writeHead(200, {
      ...headers,
      'Content-Type': mime[path.split('.').at(-1)] ?? 'application/octet-stream',
      'Content-Length': bytes.length,
      'Cache-Control': 'no-cache',
    });
    response.end(request.method === 'HEAD' ? undefined : bytes);
  } catch {
    response.writeHead(404, headers);
    response.end('File not found.');
  }
});
server.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () =>
  console.log(`Local preview PID ${process.pid}: http://127.0.0.1:${port}. Stop with Ctrl+C.`),
);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    server.close();
    server.closeAllConnections();
  });
