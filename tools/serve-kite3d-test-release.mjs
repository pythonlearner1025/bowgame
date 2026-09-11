/** Serves only the audited Kite3D release fixture over loopback for browser tests. */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';

const DEFAULT_PORT = 43173;
const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_METHOD_NOT_ALLOWED = 405;
const HTTP_INTERNAL_SERVER_ERROR = 500;
const releaseRoot = resolve('.kite3d/e2e-release');
const port = Number(process.env.BOW_RELEASE_PORT ?? DEFAULT_PORT);
const mimeTypes = new Map([
  ['.bin', 'application/octet-stream'],
  ['.gltf', 'model/gltf+json'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.md', 'text/markdown; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.wav', 'audio/wav'],
]);

function sendText(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(body);
}

const server = createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    sendText(response, HTTP_METHOD_NOT_ALLOWED, 'Method not allowed');

    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname);
  } catch {
    sendText(response, HTTP_BAD_REQUEST, 'Bad request');

    return;
  }

  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = resolve(releaseRoot, relativePath);
  if (filePath !== releaseRoot && !filePath.startsWith(`${releaseRoot}${sep}`)) {
    sendText(response, HTTP_NOT_FOUND, 'Not found');

    return;
  }

  try {
    const metadata = await stat(filePath);
    if (!metadata.isFile()) {
      sendText(response, HTTP_NOT_FOUND, 'Not found');

      return;
    }
    response.writeHead(HTTP_OK, {
      'Content-Length': metadata.size,
      'Content-Type': mimeTypes.get(extname(filePath)) ?? 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
    });
    if (request.method === 'HEAD') {
      response.end();

      return;
    }
    createReadStream(filePath).pipe(response);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      sendText(response, HTTP_NOT_FOUND, 'Not found');

      return;
    }
    console.error('Release server failed to read a file.', { error, filePath });
    sendText(response, HTTP_INTERNAL_SERVER_ERROR, 'Server error');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Kite3D release fixture listening on http://127.0.0.1:${port}`);
});
