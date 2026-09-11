/** Starts the release host and local Worker, then runs the isolated online specification. */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let releaseServer = null;
let worker = null;
let baseURL = process.env.BOWGAME_BASE_URL;
let webSocketEndpoint = process.env.BOWGAME_WS_URL;
let workerOutput = '';

async function freePort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise((resolvePromise) => server.close(resolvePromise));

  return port;
}

async function waitForRelease(url, child) {
  const deadline = Date.now() + 10_000;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`release server exited with ${child.exitCode}`);
    }

    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // The child has not bound its socket yet.
    }

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }

  throw new Error('release server did not become ready');
}

async function waitForWorker(url, origin, child) {
  const deadline = Date.now() + 25_000;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`wrangler dev exited with ${child.exitCode}`);
    }

    try {
      const response = await fetch(url, { headers: { Origin: origin } });
      if (response.status === 426) {
        return;
      }
    } catch {
      // Wrangler has not bound its socket yet.
    }

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
  }

  throw new Error('wrangler dev did not become ready');
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) {
    return;
  }
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolvePromise) => child.once('exit', resolvePromise)),
    new Promise((resolvePromise) => setTimeout(resolvePromise, 3000)),
  ]);
  if (child.exitCode === null) {
    child.kill('SIGKILL');
  }
}

try {
  if (!baseURL) {
    const releasePort = await freePort();
    baseURL = `http://127.0.0.1:${releasePort}`;
    releaseServer = spawn(process.execPath, ['tools/serve-kite3d-test-release.mjs'], {
      cwd: root,
      stdio: ['ignore', 'inherit', 'inherit'],
      env: { ...process.env, BOW_RELEASE_PORT: String(releasePort) },
    });
    await waitForRelease(baseURL, releaseServer);
  }

  if (!webSocketEndpoint) {
    const workerPort = await freePort();
    webSocketEndpoint = `ws://127.0.0.1:${workerPort}/ws`;
    worker = spawn(
      resolve(root, 'node_modules/.bin/wrangler'),
      ['dev', '--local', '--port', String(workerPort), '--log-level', 'warn'],
      { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    worker.stdout.on('data', (chunk) => {
      workerOutput += String(chunk);
      process.stdout.write(`[wrangler] ${chunk}`);
    });
    worker.stderr.on('data', (chunk) => {
      workerOutput += String(chunk);
      process.stderr.write(`[wrangler] ${chunk}`);
    });
    await waitForWorker(webSocketEndpoint.replace(/^ws/, 'http'), new URL(baseURL).origin, worker);
  }

  const playwright = spawn(
    resolve(root, 'node_modules/.bin/playwright'),
    ['test', '--config', 'tests/e2e/playwright.online.config.mjs'],
    {
      cwd: root,
      stdio: 'inherit',
      env: {
        ...process.env,
        BOWGAME_BASE_URL: baseURL,
        BOWGAME_WS_URL: webSocketEndpoint,
        BOWGAME_EVIDENCE_MODE: webSocketEndpoint.includes('workers.dev') ? 'live' : 'local',
      },
    },
  );
  const code = await new Promise((resolvePromise, reject) => {
    playwright.once('error', reject);
    playwright.once('exit', (value) => resolvePromise(value ?? 1));
  });
  if (code !== 0) {
    process.exitCode = code;
  }

  if (workerOutput.includes('"event":"exception"')) {
    console.error('wrangler emitted a structured room exception');
    process.exitCode = 1;
  }
} finally {
  await stopProcess(worker);
  await stopProcess(releaseServer);
}
