/** Specifies the standalone player's loading, input, rendering, and inspection behavior. */
import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

test('hosted player enters the real arena and advances bot combat', async ({ page }) => {
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/?collisionTest=1');
  await page.waitForFunction(() => document.documentElement.dataset.playerReady === 'true');
  const enter = page.getByRole('button', { name: 'ENTER ARENA' });
  await expect(enter).toBeVisible();
  await expect(page.locator('#kite3d-bow-game-hud')).toContainText('00 / 10  ELIMINATIONS');
  const before = await page.evaluate(() => window.__KITE_BOW_GAME__?.getState());
  expect(before?.bots).toHaveLength(3);

  await page.getByRole('textbox', { name: 'Archer name' }).fill('Rust Hunter');
  await enter.click();
  expect(await page.evaluate(() => window.__KITE_BOW_GAME__.getState().name)).toBe('Rust Hunter');
  const enteredPosition = await page.evaluate(() => {
    const game = window.__KITE_BOW_GAME__.runtime;
    const position = window.__KITE_BOW_GAME__.getState().player.position;
    game.collisionTest({ position: [position.x, position.y, position.z] });

    return position;
  });
  await page.keyboard.down('Space');
  const immediateJump = await page.evaluate(() =>
    window.__KITE_BOW_GAME__.runtime.collisionTest({ steps: 1 }),
  );
  await page.keyboard.up('Space');
  expect(immediateJump.position[1]).toBeGreaterThan(enteredPosition.y);
  await page.evaluate((position) => {
    window.__KITE_BOW_GAME__.runtime.collisionTest({
      position: [position.x, position.y, position.z],
    });
  }, enteredPosition);
  await page.keyboard.down('w');
  await page.evaluate(() => window.__KITE_BOW_GAME__.runtime.collisionTest({ steps: 1 }));
  await page.keyboard.down('Space');
  const walkingJump = await page.evaluate(() =>
    window.__KITE_BOW_GAME__.runtime.collisionTest({ steps: 1 }),
  );
  await page.keyboard.up('Space');
  await page.keyboard.up('w');
  expect(walkingJump.position[1]).toBeGreaterThan(enteredPosition.y);
  await page.evaluate(() => window.__KITE_BOW_GAME__.runtime.collisionTest({ resume: true }));
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
  expect(after?.bots).toHaveLength(3);
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
    window.__KITE_BOW_GAME__.runtime.collisionTest({ position: [9, 0, 10], yaw: 0, steps: 2 }),
  );
  expect(collision.stats.buildMs).toBeLessThan(300);
  await page.keyboard.down('w');
  const stopped = await page.evaluate(() =>
    window.__KITE_BOW_GAME__.runtime.collisionTest({ steps: 240 }),
  );
  await page.keyboard.up('w');
  expect(stopped.position[2]).toBeGreaterThan(6.5);
  expect(stopped.position[2]).toBeLessThan(9);
  expect(stopped.penetration).toBeLessThan(0.01);
  await page.evaluate(() =>
    window.__KITE_BOW_GAME__.runtime.collisionTest({
      position: [6.7, 0, -2.35],
      yaw: 0,
      steps: 30,
    }),
  );
  await page.keyboard.down('Space');
  await page.keyboard.down('w');
  await page.evaluate(() => window.__KITE_BOW_GAME__.runtime.collisionTest({ steps: 1 }));
  await page.keyboard.up('Space');
  await page.evaluate(() => window.__KITE_BOW_GAME__.runtime.state.keys.delete('Space'));
  const airborne = await page.evaluate(() =>
    window.__KITE_BOW_GAME__.runtime.collisionTest({ steps: 51 }),
  );
  await page.keyboard.up('w');
  const landed = await page.evaluate(() =>
    window.__KITE_BOW_GAME__.runtime.collisionTest({ steps: 480 }),
  );
  expect(airborne.position[1]).toBeGreaterThan(0.7);
  expect(landed.grounded, JSON.stringify({ airborne, landed })).toBe(true);
  expect(landed.position[1]).toBeGreaterThan(-0.05);
  expect(landed.position[1]).toBeLessThan(1);
  expect(landed.penetration).toBeLessThan(0.01);
  const impacts = [];

  for (const remote of [false, true]) {
    const impact = await page.evaluate(
      (remote) =>
        window.__KITE_BOW_GAME__.runtime.collisionTest({
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

  expect(landed.spawns).toHaveLength(10);
  for (const spawn of landed.spawns) {
    expect(spawn.penetration).toBeLessThan(0.001);
  }
  await page.evaluate(() => window.__KITE_BOW_GAME__.runtime.collisionTest({ resume: true }));
  const evidenceDir = resolve(root, 'evidence');
  await mkdir(evidenceDir, { recursive: true });
  await page.locator('#bow-canvas').screenshot({ path: resolve(evidenceDir, 'solo-arena.png') });
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
  await page.evaluate(() => window.__KITE_BOW_GAME__.stop());
  await expect(hud).toHaveCount(0);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('A saved username is reused without extension and can be cleared.', async ({ page }) => {
  test.setTimeout(90_000);
  const joins = [];
  await page.routeWebSocket('**/ws?**', (socket) => {
    socket.send(
      JSON.stringify({
        v: 1,
        type: 'welcome',
        playerId: 'self',
        roster: [{ id: 'self', name: 'Rust Hunter', slot: 0 }],
        scores: { self: 0 },
        scoreLimit: 20,
        round: 1,
      }),
    );
    socket.onMessage((rawMessage) => {
      const message = JSON.parse(rawMessage);

      if (message.type === 'join') {
        joins.push(message.name);
        socket.send(
          JSON.stringify({
            v: 1,
            type: 'join',
            playerId: 'self',
            name: message.name,
            slot: 0,
          }),
        );
      }
    });
  });
  await page.goto('/?online=1');
  await page.waitForFunction(() => document.documentElement.dataset.playerReady === 'true');
  const input = page.getByRole('textbox', { name: 'Archer name' });
  await expect(input).toHaveValue('');
  await expect(input).toHaveAttribute('placeholder', /^Archer-\d{4}$/);
  await input.fill('Rust Hunter');
  await page.getByRole('button', { name: 'ENTER ARENA' }).click();
  await expect.poll(() => joins.at(-1)).toBe('Rust Hunter');
  const savedRecord = await page.evaluate(() => localStorage.getItem('bowgame.player-name.v1'));
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.playerReady === 'true');
  await expect(input).toHaveValue('');
  await expect(input).toHaveAttribute('placeholder', 'Rust Hunter');
  await page.screenshot({ path: resolve(root, 'evidence/gritty-username-entry.png') });
  await page.getByRole('button', { name: 'ENTER ARENA' }).click();
  expect(await page.evaluate(() => window.__KITE_BOW_GAME__.getState().name)).toBe('Rust Hunter');
  expect(await page.evaluate(() => localStorage.getItem('bowgame.player-name.v1'))).toBe(
    savedRecord,
  );
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.playerReady === 'true');
  await page.getByRole('button', { name: 'Clear saved name' }).click();
  await expect(input).toHaveAttribute('placeholder', /^Archer-\d{4}$/);
  expect(await page.evaluate(() => localStorage.getItem('bowgame.player-name.v1'))).toBeNull();
  await page.getByRole('button', { name: 'ENTER ARENA' }).click();
  await expect.poll(() => joins.at(-1)).toMatch(/^Archer-\d{4}$/);
  expect(await page.evaluate(() => localStorage.getItem('bowgame.player-name.v1'))).toBeNull();
});
