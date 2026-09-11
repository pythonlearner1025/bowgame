/** Specifies the two-client release flow against the WebSocket-only local Worker. */
import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const baseURL = process.env.BOWGAME_BASE_URL;
const webSocketEndpoint = process.env.BOWGAME_WS_URL;
const mode = process.env.BOWGAME_EVIDENCE_MODE ?? 'local';
const HTTP_NOT_FOUND = 404;
const HTTP_FORBIDDEN = 403;
const HTTP_UPGRADE_REQUIRED = 426;

if (!baseURL || !webSocketEndpoint) {
  throw new Error('BOWGAME_BASE_URL and BOWGAME_WS_URL are required');
}

function onlineUrl() {
  const url = new URL('/?online=1&collisionTest=1', baseURL);
  url.searchParams.set('ws', webSocketEndpoint);

  return url.href;
}

async function enterOnline(page, name, errors, sockets) {
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('websocket', (socket) => sockets.push(socket));
  await page.goto(onlineUrl());
  await page.waitForFunction(() => window.kite3dGame?.telemetry?.ready === true);
  await page.waitForFunction(
    () => window.__KITE_BOW_GAME__?.getState()?.network?.status === 'connected',
    undefined,
    { timeout: 30_000 },
  );
  await page.getByRole('textbox', { name: 'Archer name' }).fill(name);
  await page.getByRole('button', { name: 'ENTER ARENA' }).click();
  await expect.poll(() => page.evaluate(() => window.__KITE_BOW_GAME__.getState().name)).toBe(name);
}

async function runRawSocketChecks(page) {
  return page.evaluate(async (endpoint) => {
    class BrowserSocketProbe {
      socket;
      messages = [];
      waiters = [];

      constructor(url) {
        this.socket = new WebSocket(url);
        this.socket.addEventListener('message', (event) => {
          const message = JSON.parse(String(event.data));
          this.messages.push(message);

          for (const waiter of [...this.waiters]) {
            if (waiter.type !== message.type) {
              continue;
            }
            this.waiters.splice(this.waiters.indexOf(waiter), 1);
            waiter.resolve(message);
          }
        });
      }

      opened() {
        return new Promise((resolve, reject) => {
          if (this.socket.readyState === WebSocket.OPEN) {
            resolve();

            return;
          }
          this.socket.addEventListener('open', resolve, { once: true });
          this.socket.addEventListener('error', () => reject(new Error('socket failed to open')), {
            once: true,
          });
        });
      }

      waitFor(type, timeout = 10_000) {
        const found = this.messages.find((message) => message.type === type);
        if (found) {
          return Promise.resolve(found);
        }

        return new Promise((resolve, reject) => {
          const waiter = { type, resolve };
          this.waiters.push(waiter);
          setTimeout(() => {
            const index = this.waiters.indexOf(waiter);
            if (index >= 0) {
              this.waiters.splice(index, 1);
            }
            reject(new Error(`timed out waiting for ${type}`));
          }, timeout);
        });
      }

      send(value) {
        this.socket.send(JSON.stringify(value));
      }

      close() {
        this.socket.close();
      }
    }

    const capRoom = `cap-${Date.now()}`;
    const accepted = [];

    for (let index = 0; index < 10; index++) {
      const url = new URL(endpoint);
      url.searchParams.set('room', capRoom);
      url.searchParams.set('name', `P${index}`);
      const probe = new BrowserSocketProbe(url);
      await probe.opened();
      await probe.waitFor('welcome');
      accepted.push(probe);
    }

    const eleventhUrl = new URL(endpoint);
    eleventhUrl.searchParams.set('room', capRoom);
    eleventhUrl.searchParams.set('name', 'P10');
    const eleventh = new BrowserSocketProbe(eleventhUrl);
    await eleventh.opened();
    const full = await eleventh.waitFor('full');
    for (const probe of accepted) {
      probe.close();
    }
    eleventh.close();

    const roundRoom = `round-${Date.now()}`;
    const killerUrl = new URL(endpoint);
    killerUrl.searchParams.set('room', roundRoom);
    killerUrl.searchParams.set('name', 'Killer');
    const victimUrl = new URL(endpoint);
    victimUrl.searchParams.set('room', roundRoom);
    victimUrl.searchParams.set('name', 'Victim');
    const killer = new BrowserSocketProbe(killerUrl);
    const victim = new BrowserSocketProbe(victimUrl);
    await killer.opened();
    const killerWelcome = await killer.waitFor('welcome');
    await victim.opened();
    await victim.waitFor('welcome');
    const ended = killer.waitFor('round_end');
    const reset = killer.waitFor('round_reset', 12_000);
    const started = Date.now();

    for (let index = 0; index < 20; index++) {
      victim.send({ v: 1, type: 'death', killerId: killerWelcome.playerId });
    }

    const roundEnd = await ended;
    const roundReset = await reset;
    const resetDelayMs = Date.now() - started;
    killer.close();
    victim.close();

    return {
      cap: { accepted: accepted.length, eleventhRejected: full.type === 'full' },
      round: {
        winnerId: roundEnd.winnerId,
        scores: roundEnd.scores,
        resetRound: roundReset.round,
        resetDelayMs,
      },
    };
  }, webSocketEndpoint);
}

test('two release pages play, the gate holds, room limits hold, and rounds reset', async ({
  browser,
  request,
}) => {
  const workerHttpUrl = webSocketEndpoint.replace(/^ws/, 'http');
  const releaseOrigin = new URL(baseURL).origin;
  const notFound = await request.get(new URL('/not-websocket', workerHttpUrl).href);
  const missingOrigin = await request.get(workerHttpUrl);
  const hostileOrigin = await request.get(workerHttpUrl, {
    headers: { Origin: 'https://app.blitz.dev.attacker.example' },
  });
  const allowedOrigin = await request.get(workerHttpUrl, {
    headers: { Origin: releaseOrigin },
  });
  expect(notFound.status()).toBe(HTTP_NOT_FOUND);
  expect(missingOrigin.status()).toBe(HTTP_FORBIDDEN);
  expect(hostileOrigin.status()).toBe(HTTP_FORBIDDEN);
  expect(allowedOrigin.status()).toBe(HTTP_UPGRADE_REQUIRED);

  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const pageA = await context.newPage();
  const pageB = await context.newPage();
  const errors = [];
  const socketsA = [];
  const socketsB = [];
  await enterOnline(pageA, 'Archer-A', errors, socketsA);
  await pageA.evaluate(() => window.viewer.timeline.stop());
  await enterOnline(pageB, 'Archer-B', errors, socketsB);
  await Promise.all([
    pageA.waitForFunction(() => window.__KITE_BOW_GAME__?.getState()?.remotePlayers?.length === 1),
    pageB.waitForFunction(() => window.__KITE_BOW_GAME__?.getState()?.remotePlayers?.length === 1),
  ]);
  const beforeA = await pageA.evaluate(() => window.__KITE_BOW_GAME__.getState());
  const beforeB = await pageB.evaluate(() => window.__KITE_BOW_GAME__.getState());
  expect(beforeA.bots).toHaveLength(0);
  expect(beforeB.bots).toHaveLength(0);
  expect(beforeA.remotePlayers).toHaveLength(1);
  expect(beforeB.remotePlayers).toHaveLength(1);
  const playerAId = beforeA.player.id;
  const playerBId = beforeB.player.id;
  expect(playerAId).toBeTruthy();
  expect(playerBId).toBeTruthy();

  await pageB.evaluate(() =>
    window.__KITE_BOW_GAME__.collisionTest({ position: [0, 0, 10], yaw: Math.PI, steps: 12 }),
  );
  await pageB.waitForTimeout(750);
  await pageB.evaluate(() => window.viewer.timeline.stop());
  await pageA.evaluate(() => window.viewer.timeline.start());
  await pageA.waitForFunction(
    () => Math.abs(window.__KITE_BOW_GAME__.getState().remotePlayers[0].position.z - 10) < 1,
    undefined,
    { timeout: 15_000 },
  );
  if (mode === 'live') {
    await pageA
      .locator('#kite3d-canvas')
      .screenshot({ path: resolve(root, 'evidence/online-two-players.png') });
  }
  await pageA.keyboard.press('F8');
  await expect(pageA.locator('#kite3d-bow-debug')).toBeVisible();
  const telemetry = await pageA.evaluate(() => window.__KITE_BOW_TELEMETRY__.exportData());
  const lastSample = telemetry.samples.at(-1);
  const sum = (direction) =>
    telemetry.samples.reduce(
      (total, sample) => total + (sample.network[direction].byType.state?.count ?? 0),
      0,
    );
  expect(telemetry.schemaVersion).toBe(1);
  expect(telemetry.samples.length).toBeGreaterThan(0);
  expect(telemetry.samples.some((sample) => sample.frameTimeMs.count > 0)).toBe(true);
  expect(sum('inbound')).toBeGreaterThan(0);
  expect(sum('outbound')).toBeGreaterThan(0);
  expect(lastSample.remoteStateStaleness.players).toHaveLength(1);
  const downloadPromise = pageA.waitForEvent('download');
  await pageA.keyboard.press('F9');
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^bowgame-telemetry-.*\.json$/);
  await pageA.keyboard.press('F8');
  await pageA.evaluate(() => window.viewer.timeline.stop());
  await pageA.evaluate(() => window.__KITE_BOW_SESSION__.ping());
  await pageA.waitForFunction(() => window.__KITE_BOW_GAME__.getState().network.latencyMs !== null);
  const scoresBefore = { ...beforeA.network.scores };
  await pageA.evaluate(
    ({ target }) => window.__KITE_BOW_SESSION__.sendHit(target, 'e2e-hit-1', 60, false),
    { target: playerBId },
  );
  await pageB.waitForFunction(() => window.__KITE_BOW_GAME__.getState().health === 40);
  await pageA.evaluate(
    ({ target }) => window.__KITE_BOW_SESSION__.sendHit(target, 'e2e-hit-2', 60, false),
    { target: playerBId },
  );
  await Promise.all([
    pageA.waitForFunction(
      (id) => window.__KITE_BOW_GAME__.getState().network.scores[id] === 1,
      playerAId,
    ),
    pageB.waitForFunction(
      (id) => window.__KITE_BOW_GAME__.getState().network.scores[id] === 1,
      playerAId,
    ),
  ]);
  const afterA = await pageA.evaluate(() => window.__KITE_BOW_GAME__.getState());
  const afterB = await pageB.evaluate(() => window.__KITE_BOW_GAME__.getState());
  expect(afterB.health).toBe(0);

  const rawChecks = await runRawSocketChecks(pageA);
  expect(rawChecks.cap).toEqual({ accepted: 10, eleventhRejected: true });
  expect(rawChecks.round.resetRound).toBeGreaterThan(1);
  expect(rawChecks.round.resetDelayMs).toBeGreaterThanOrEqual(4_000);

  const evidence = {
    mode,
    baseURL,
    webSocketEndpoint,
    originGate: { notFound: 404, missing: 403, hostile: 403, allowedWithoutUpgrade: 426 },
    roster: afterA.network.players.map(({ id, name, slot, local }) => ({ id, name, slot, local })),
    remoteCounts: [afterA.remotePlayers.length, afterB.remotePlayers.length],
    scoresBefore,
    scoresAfter: afterA.network.scores,
    victimHealthAfter: afterB.health,
    latencyMs: afterA.network.latencyMs,
    ...rawChecks,
    consoleErrors: errors,
  };
  await mkdir(resolve(root, 'evidence'), { recursive: true });
  await writeFile(
    resolve(root, `evidence/online-${mode}.json`),
    JSON.stringify(evidence, null, 2) + '\n',
  );

  const applicationSocketsA = socketsA.filter(
    (socket) => new URL(socket.url()).searchParams.get('room') === 'main',
  );
  const applicationSocketsB = socketsB.filter(
    (socket) => new URL(socket.url()).searchParams.get('room') === 'main',
  );
  expect(applicationSocketsA).toHaveLength(1);
  expect(applicationSocketsB).toHaveLength(1);
  const socketCloseEvents = [...applicationSocketsA, ...applicationSocketsB].map((socket) =>
    socket.waitForEvent('close', { timeout: 15_000 }),
  );
  await Promise.all([
    pageA.evaluate(() => window.__KITE_BOW_GAME__.stop()),
    pageB.evaluate(() => window.__KITE_BOW_GAME__.stop()),
    ...socketCloseEvents,
  ]);
  expect(applicationSocketsA.every((socket) => socket.isClosed())).toBe(true);
  expect(applicationSocketsB.every((socket) => socket.isClosed())).toBe(true);
  expect(errors).toEqual([]);
  await context.close();
});
