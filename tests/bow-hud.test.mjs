/** Specifies cached HUD writes, health presentation, and expired death-feed removal. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadSystem, makeConfig, makeViewer } from './helpers/bow-system-harness.mjs';

const { Hud } = await loadSystem('Hud');
const { GameState } = await loadSystem('GameState');

test('Hud writes changed health once and prunes expired death notices', async () => {
  const config = makeConfig();
  const state = new GameState(config);
  const viewer = await makeViewer();
  const entry = { start() {}, update() {}, stop() {}, isOnline: () => false };
  const hud = new Hud(viewer, state, () => config, entry);
  state.deathFeed = [{ killer: 'ASH', victim: 'YOU', expiresAtSeconds: 1 }];
  hud.start();
  const overlay = viewer.container.children[0];
  const healthBar = overlay.children[3].children[0].children[0];
  const writesBefore = healthBar.style.writes;

  hud.update();
  state.hp = 20;
  hud.update();
  state.elapsed = 2;
  hud.update();

  assert.equal(healthBar.style.writes, writesBefore + 2);
  assert.equal(healthBar.style.values.get('width'), '20%');
  assert.equal(healthBar.style.values.get('--health-color'), '#a14f37');
  assert.deepEqual(state.deathFeed, []);
  hud.stop();
  assert.equal(viewer.container.children.length, 0);
});
