/** Specifies the standalone player's loading, input, rendering, and inspection behavior. */
import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const EXPECTED_IMPORT_COUNT = 5;
const SOFTWARE_RENDER_SCALE = 0.5;
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const EXPECTED_SOLO_BOT_COUNT = 3;

test('hosted player enters the real arena and advances bot combat', async ({ page, request }) => {
  const consoleErrors = [];
  const pageErrors = [];
  const webSockets = [];
  const failedResponses = [];
  const externalRequests = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('websocket', (socket) => webSockets.push(socket.url()));
  page.on('request', (request) => {
    const url = new URL(request.url());

    if (['http:', 'https:'].includes(url.protocol) && url.origin !== 'http://127.0.0.1:43173') {
      externalRequests.push(request.url());
    }
  });
  page.on('response', (response) => {
    if (response.status() >= 400) {
      failedResponses.push({ status: response.status(), url: response.url() });
    }
  });

  await page.goto('/?collisionTest=1');
  await page.waitForFunction(() => window.kite3dGame?.telemetry?.ready === true);
  const releaseShell = await page.evaluate(async () => {
    const importMap = JSON.parse(document.querySelector('script[type="importmap"]').textContent);
    const packageManifest = await fetch('/package.json').then((response) => response.json());

    return {
      canvasId: window.viewer.canvas.id,
      importValues: Object.values(importMap.imports),
      packageManifest,
      loadingPresent: Boolean(document.querySelector('#kite3d-bow-loading')),
      runtimeMeta: document.querySelector('meta[name="kite3d-runtime"]')?.content,
      componentValidation: window.__KITE_BOW_GAME__.validateForKite(),
      platformValidation: await window.kite3dGame.validate(),
      renderScale: window.viewer.renderManager.renderScale,
    };
  });
  const missing = await request.get('/not-a-release-file');
  const head = await request.head('/index.html');
  expect(releaseShell.canvasId).toBe('kite3d-canvas');
  expect(releaseShell.runtimeMeta).toMatch(/^0\.13\.2 [a-f0-9]{64}$/);
  expect(releaseShell.importValues).toEqual(
    Array(EXPECTED_IMPORT_COUNT).fill('./_blitz/runtime.js'),
  );
  expect(releaseShell.packageManifest.devDependencies).toBeUndefined();
  expect(releaseShell.loadingPresent).toBe(false);
  expect(releaseShell.componentValidation.status).toBe('pass');
  expect(releaseShell.platformValidation.status).toBe('pass');
  expect(releaseShell.renderScale).toBe(SOFTWARE_RENDER_SCALE);
  expect(missing.status()).toBe(HTTP_NOT_FOUND);
  expect(missing.headers()['x-content-type-options']).toBe('nosniff');
  expect(head.status()).toBe(HTTP_OK);
  expect(await head.body()).toHaveLength(0);
  expect(webSockets).toEqual([]);
  expect(externalRequests).toEqual([]);
  const enter = page.getByRole('button', { name: 'ENTER ARENA' });
  await expect(enter).toBeVisible();
  await expect(page.locator('#kite3d-bow-game-hud')).toContainText('00 / 10  ELIMINATIONS');
  const before = await page.evaluate(() => window.__KITE_BOW_GAME__?.getState());
  expect(before?.bots).toHaveLength(EXPECTED_SOLO_BOT_COUNT);

  await page.getByRole('textbox', { name: 'Archer name' }).fill('Rust Hunter');
  await enter.click();
  expect(await page.evaluate(() => window.__KITE_BOW_GAME__.getState().name)).toBe('Rust Hunter');
  const enteredPosition = await page.evaluate(() => {
    const game = window.__KITE_BOW_GAME__;
    const position = window.__KITE_BOW_GAME__.getState().player.position;
    game.collisionTest({ position: [position.x, position.y, position.z] });

    return position;
  });
  await page.keyboard.down('Space');
  const immediateJump = await page.evaluate(() =>
    window.__KITE_BOW_GAME__.collisionTest({ steps: 1 }),
  );
  await page.keyboard.up('Space');
  expect(immediateJump.position[1]).toBeGreaterThan(enteredPosition.y);
  await page.evaluate((position) => {
    window.__KITE_BOW_GAME__.collisionTest({
      position: [position.x, position.y, position.z],
    });
  }, enteredPosition);
  await page.keyboard.down('w');
  await page.evaluate(() => window.__KITE_BOW_GAME__.collisionTest({ steps: 1 }));
  await page.keyboard.down('Space');
  const walkingJump = await page.evaluate(() =>
    window.__KITE_BOW_GAME__.collisionTest({ steps: 1 }),
  );
  await page.keyboard.up('Space');
  await page.keyboard.up('w');
  expect(walkingJump.position[1]).toBeGreaterThan(enteredPosition.y);
  await page.evaluate(() => window.__KITE_BOW_GAME__.collisionTest({ resume: true }));
  await page.waitForTimeout(3500);
  const hud = page.locator('#kite3d-bow-game-hud');
  await expect(hud.locator('[data-hud="modal"]')).toBeHidden();
  await expect(hud.locator('[data-hud="health"]')).toHaveAttribute('role', 'progressbar');
  await expect(hud.locator('[data-hud="health"]')).toHaveText('');
  await expect(hud.locator('[data-hud="board"]')).toContainText('YOU');
  const layout = await page.evaluate(() => {
    const bounds = (id) => {
      const rectangle = document.querySelector(`[data-hud="${id}"]`).getBoundingClientRect();

      return {
        x: rectangle.x,
        y: rectangle.y,
        right: rectangle.right,
        bottom: rectangle.bottom,
      };
    };

    return { health: bounds('health'), board: bounds('board'), feed: bounds('feed') };
  });
  expect(layout.health.x).toBeLessThan(40);
  expect(layout.health.y).toBeGreaterThan(640);
  expect(layout.board.x).toBeGreaterThan(950);
  expect(layout.feed.y).toBeGreaterThan(layout.board.bottom);
  const visibleText = await hud.innerText();
  expect(visibleText).not.toMatch(/TIMBER|ASH.*LOCAL|WASD|FIELD BOW|ARROWS|HP|MS RTT/);
  await page.screenshot({ path: resolve(root, 'evidence/gritty-hud-gameplay.png') });
  const after = await page.evaluate(() => window.__KITE_BOW_GAME__?.getState());
  expect(after?.bots).toHaveLength(EXPECTED_SOLO_BOT_COUNT);
  expect(after?.elapsed).toBeGreaterThan(0.3);
  const moved = after.bots.some((bot, index) => {
    const prior = before.bots[index].position;

    return Math.hypot(bot.position.x - prior.x, bot.position.z - prior.z) > 0.25;
  });
  expect(moved).toBe(true);
  await expect(page.locator('#kite3d-bow-game-hud')).toBeVisible();
  const sceneStats = await page.evaluate(() => {
    const arena = window.viewer.scene.getObjectByName('K3D_BOW_RUNTIME_ARENA');
    const stats = { objects: 0, meshes: 0, instancedMeshes: 0, instances: {} };
    arena?.traverse((object) => {
      stats.objects++;
      if (object.isMesh) {
        stats.meshes++;
      }

      if (object.isInstancedMesh) {
        stats.instancedMeshes++;
        stats.instances[object.name] = object.count;
      }
    });

    return stats;
  });
  expect(sceneStats.instances).toEqual({
    'Detailed pine needle boughs': 6720,
    'Tapered pine branches': 1680,
    'Dry forest grasses': 3400,
    'Forest scree': 160,
  });

  // Real key handlers feed the same 120 Hz step; deterministic bursts avoid software-WebGL wall-clock drift.
  const collision = await page.evaluate(() =>
    window.__KITE_BOW_GAME__.collisionTest({ position: [9, 0, 10], yaw: 0, steps: 2 }),
  );
  expect(collision.stats.buildMs).toBeLessThan(300);
  await page.keyboard.down('w');
  const stopped = await page.evaluate(() => window.__KITE_BOW_GAME__.collisionTest({ steps: 240 }));
  await page.keyboard.up('w');
  expect(stopped.position[2]).toBeGreaterThan(6.5);
  expect(stopped.position[2]).toBeLessThan(9);
  expect(stopped.penetration).toBeLessThan(0.01);
  await page.evaluate(() =>
    window.__KITE_BOW_GAME__.collisionTest({
      position: [6.7, 0, -2.35],
      yaw: 0,
      steps: 30,
    }),
  );
  await page.keyboard.down('Space');
  await page.keyboard.down('w');
  await page.evaluate(() => window.__KITE_BOW_GAME__.collisionTest({ steps: 1 }));
  await page.keyboard.up('Space');
  await page.evaluate(() => window.__KITE_BOW_GAME__.runtime.state.keys.delete('Space'));
  const airborne = await page.evaluate(() => window.__KITE_BOW_GAME__.collisionTest({ steps: 51 }));
  await page.keyboard.up('w');
  const landed = await page.evaluate(() => window.__KITE_BOW_GAME__.collisionTest({ steps: 480 }));
  expect(airborne.position[1]).toBeGreaterThan(0.7);
  expect(landed.grounded, JSON.stringify({ airborne, landed })).toBe(true);
  expect(landed.position[1]).toBeGreaterThan(-0.05);
  expect(landed.position[1]).toBeLessThan(1);
  expect(landed.penetration).toBeLessThan(0.01);
  const impacts = [];

  for (const remote of [false, true]) {
    const impact = await page.evaluate(
      (remote) =>
        window.__KITE_BOW_GAME__.collisionTest({
          position: [0, 0, 17],
          fire: { origin: [9, 1.3, 10], direction: [0, 0, -1], remote },
          steps: 12,
        }),
      remote,
    );
    expect(impact.lastImpact).not.toBeNull();
    expect(impact.rockDistance).toBeLessThan(0.02);
    impacts.push(impact);
  }

  expect(landed.spawns).toHaveLength(4);
  for (const spawn of landed.spawns) {
    expect(spawn.penetration).toBeLessThan(0.001);
  }
  await page.evaluate(() => window.__KITE_BOW_GAME__.collisionTest({ resume: true }));
  const evidenceDir = resolve(root, 'evidence');
  await mkdir(evidenceDir, { recursive: true });
  await page.locator('#kite3d-canvas').screenshot({ path: resolve(evidenceDir, 'solo-arena.png') });
  const log = {
    collision: { initial: collision, stopped, airborne, landed, impacts },
    url: page.url(),
    bots: after.bots.length,
    elapsed: after.elapsed,
    before: before.bots.map((bot) => bot.position),
    after: after.bots.map((bot) => bot.position),
    scoreText: await page.locator('[data-hud="score"]').textContent(),
    renderBatch: after.renderBatch,
    sceneStats,
    pointerLock: await page.evaluate(() => document.pointerLockElement?.id ?? null),
    consoleErrors,
    pageErrors,
  };
  await writeFile(resolve(evidenceDir, 'e2e-run.json'), JSON.stringify(log, null, 2) + '\n');
  await page.evaluate(() => {
    window.viewer.timeline.stop();
    const game = window.__KITE_BOW_GAME__.runtime;
    game.damage(0, 100, -1, false);
    game.damage(-1, 80, 1, false);
    game.updateHud();
  });
  await expect(hud.locator('[data-hud="feed"]')).toContainText('YOU→ASH');
  await expect(hud.locator('[data-hud="health"]')).toHaveAttribute('aria-valuenow', '20');
  await expect
    .poll(() =>
      hud
        .locator('[data-hud="healthbar"]')
        .evaluate((bar) =>
          Math.round((bar.getBoundingClientRect().width / bar.parentElement.clientWidth) * 100),
        ),
    )
    .toBe(20);
  await page.screenshot({ path: resolve(root, 'evidence/gritty-hud-combat.png') });
  await page.evaluate(() => {
    const game = window.__KITE_BOW_GAME__.runtime;

    for (let i = 0; i < 5; i++) {
      game.addDeath('ROOK', `ARCHER ${i}`);
    }

    game.updateHud();
  });
  await expect(hud.locator('.death-row')).toHaveCount(4);
  await expect(hud.locator('.death-row').first()).toHaveText('ROOK→ARCHER 4');
  await page.setViewportSize({ width: 640, height: 480 });
  await page.evaluate(() => window.__KITE_BOW_GAME__.runtime.updateHud());
  const compactLayout = await page.evaluate(() => {
    const health = document.querySelector('[data-hud="health"]').getBoundingClientRect();
    const feed = document.querySelector('[data-hud="feed"]').getBoundingClientRect();

    return {
      healthBottom: health.bottom,
      healthTop: health.top,
      feedBottom: feed.bottom,
      feedRight: feed.right,
    };
  });
  expect(compactLayout.healthBottom).toBeLessThanOrEqual(480);
  expect(compactLayout.feedRight).toBeLessThanOrEqual(640);
  expect(compactLayout.feedBottom).toBeLessThan(compactLayout.healthTop);
  await page.evaluate(() => {
    const game = window.__KITE_BOW_GAME__.runtime;
    game.state.elapsed += 9;
    game.updateHud();
  });
  await expect(hud.locator('.death-row')).toHaveCount(0);
  const stoppedRuntimeRoots = await page.evaluate(() => {
    const viewer = window.viewer;
    window.__KITE_BOW_GAME__.stop();

    return viewer.scene.children.filter((object) => object.name === 'K3D_BOW_RUNTIME').length;
  });
  await expect(hud).toHaveCount(0);
  expect(stoppedRuntimeRoots).toBe(0);
  expect(failedResponses).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('A saved username is reused without extension and can be cleared.', async ({ page }) => {
  test.setTimeout(90_000);
  const webSockets = [];
  page.on('websocket', (socket) => webSockets.push(socket.url()));
  await page.goto('/?solo=1');
  await page.waitForFunction(() => window.kite3dGame?.telemetry?.ready === true);
  const input = page.getByRole('textbox', { name: 'Archer name' });
  await expect(input).toHaveValue('');
  await expect(input).toHaveAttribute('placeholder', /^Archer-\d{4}$/);
  await input.fill('Rust Hunter');
  await page.getByRole('button', { name: 'ENTER ARENA' }).click();
  expect(await page.evaluate(() => window.__KITE_BOW_GAME__.getState().name)).toBe('Rust Hunter');
  const savedRecord = await page.evaluate(() => localStorage.getItem('bowgame.player-name.v1'));
  await page.reload();
  await page.waitForFunction(() => window.kite3dGame?.telemetry?.ready === true);
  await expect(input).toHaveValue('');
  await expect(input).toHaveAttribute('placeholder', 'Rust Hunter');
  await page.screenshot({ path: resolve(root, 'evidence/gritty-username-entry.png') });
  await page.getByRole('button', { name: 'ENTER ARENA' }).click();
  expect(await page.evaluate(() => window.__KITE_BOW_GAME__.getState().name)).toBe('Rust Hunter');
  expect(await page.evaluate(() => localStorage.getItem('bowgame.player-name.v1'))).toBe(
    savedRecord,
  );
  await page.reload();
  await page.waitForFunction(() => window.kite3dGame?.telemetry?.ready === true);
  await page.getByRole('button', { name: 'Clear saved name' }).click();
  await expect(input).toHaveAttribute('placeholder', /^Archer-\d{4}$/);
  expect(await page.evaluate(() => localStorage.getItem('bowgame.player-name.v1'))).toBeNull();
  await page.getByRole('button', { name: 'ENTER ARENA' }).click();
  expect(await page.evaluate(() => window.__KITE_BOW_GAME__.getState().name)).toMatch(
    /^Archer-\d{4}$/,
  );
  expect(await page.evaluate(() => localStorage.getItem('bowgame.player-name.v1'))).toBeNull();
  expect(webSockets).toEqual([]);
});

test('The stats.js panel sits top-left above the HUD and the viewer loop redraws it', async ({
  page,
}) => {
  await page.goto('/?solo=1');
  await page.waitForFunction(() => window.kite3dGame?.telemetry?.ready === true);
  const panel = page.locator('#stats-js');
  await expect(panel).toBeVisible();
  // The HUD mounts before the platform-ready telemetry is published.
  await expect(page.locator('#kite3d-bow-game-hud')).toBeAttached();

  const box = await panel.boundingBox();
  expect(Math.round(box.x)).toBe(0);
  expect(Math.round(box.y)).toBe(0);

  const stacking = await page.evaluate(() => {
    const stats = document.querySelector('#stats-js');
    const hud = document.querySelector('#kite3d-bow-game-hud');

    const statsBox = stats.getBoundingClientRect();
    const centerX = statsBox.left + statsBox.width / 2;
    const centerY = statsBox.top + statsBox.height / 2;

    return {
      statsZ: Number(getComputedStyle(stats).zIndex),
      hudZ: Number(getComputedStyle(hud).zIndex),
      sameParent: stats.parentElement === hud.parentElement,
      hitsPanel: Boolean(document.elementFromPoint(centerX, centerY)?.closest('#stats-js')),
    };
  });
  expect(stacking.sameParent).toBe(true);
  expect(stacking.statsZ).toBeGreaterThan(stacking.hudZ);
  expect(stacking.hitsPanel).toBe(true);

  // The stats.js FPS graph repaints once per second, and only when the viewer loop calls end().
  const readGraph = () =>
    page.evaluate(() => document.querySelector('#stats-js canvas').toDataURL());
  const firstGraph = await readGraph();
  await expect.poll(readGraph, { timeout: 5000 }).not.toBe(firstGraph);
});

test('The hosted player creates its viewer with MSAA off', async ({ page }) => {
  await page.goto('/?solo=1');
  await page.waitForFunction(() => window.kite3dGame?.telemetry?.ready === true);

  // ExtendedRenderPass reads this flag each frame to choose the 4-sample target.
  expect(await page.evaluate(() => window.viewer.renderManager.msaa)).toBe(false);
});
