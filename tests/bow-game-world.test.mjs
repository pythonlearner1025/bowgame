/** Specifies arena render ownership, restoration, and online slot spawning. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadSystem, makeConfig, makeViewer } from './helpers/bow-system-harness.mjs';

const { GameWorld } = await loadSystem('GameWorld');
const { Group } = await import('threepipe');

test('GameWorld restores viewer settings and computes stable slot spawns', async () => {
  const viewer = await makeViewer();
  const decoration = new Group();
  viewer.scene.modelRoot.add(decoration);
  const originalBackground = viewer.scene.background;
  const world = new GameWorld(viewer, { ownsArena: false });
  const config = makeConfig();

  world.start(config);
  const ringSpawn = world.getSlotSpawn(config, 4);

  assert.equal(viewer.renderManager.renderScale, 1.1);
  assert.equal(decoration.visible, false);
  assert.deepEqual(ringSpawn.toArray(), [19, 0, -18]);
  world.stop();
  assert.equal(viewer.renderManager.renderScale, 2);
  assert.equal(viewer.scene.background, originalBackground);
  assert.equal(decoration.visible, true);
  assert.equal(viewer.dirtyCalls, 1);
});
