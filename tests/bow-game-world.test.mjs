/** Specifies arena render ownership, restoration, and online slot spawning. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadSystem, makeConfig, makeViewer } from './helpers/bow-system-harness.mjs';

const { GameWorld, buildGameWorld } = await loadSystem('GameWorld');
const { Group } = await import('threepipe');
const SOFTWARE_RENDER_SCALE = 0.5;

test('GameWorld restores viewer settings and computes stable slot spawns', async () => {
  const viewer = await makeViewer();
  const decoration = new Group();
  viewer.scene.modelRoot.add(decoration);
  const originalBackground = viewer.scene.background;
  const world = new GameWorld(viewer, {
    ownsArena: false,
    authoredPreviewRoot: decoration,
  });
  const config = makeConfig();

  world.start(config);
  const ringSpawn = world.getSlotSpawn(config, 4);
  const sun = world.root.children.find((object) => object.isDirectionalLight);

  assert.equal(viewer.renderManager.renderScale, 1.1);
  assert.equal(sun.castShadow, true);
  assert.equal(decoration.visible, false);
  assert.deepEqual(ringSpawn.toArray(), [19, 0, -18]);
  world.stop();
  assert.equal(viewer.renderManager.renderScale, 2);
  assert.equal(viewer.scene.background, originalBackground);
  assert.equal(decoration.visible, true);
  assert.equal(viewer.dirtyCalls, 1);
});

test('GameWorld builds the seeded arena and its matching runtime configuration', () => {
  const { arenaRoot, config } = buildGameWorld({
    botCount: 3,
    scoreLimit: 10,
    difficulty: 'normal',
  });

  assert.equal(arenaRoot.name, 'K3D_BOW_RUNTIME_ARENA');
  assert.equal(config.botCount, 3);
  assert.equal(config.scoreLimit, 10);
  assert.equal(config.obstacles.length, 56);
  assert.equal(config.botSpawns.length, 3);
  assert.ok(arenaRoot.getObjectByName('Arena boundary barrier'));
});

const SOFTWARE_RENDERER_CASES = [
  'ANGLE SwiftShader driver',
  'Mesa llvmpipe (LLVM 19.1.7, 256 bits)',
  'Mesa softpipe',
  'Mesa lavapipe',
  'Generic software renderer',
];

for (const rendererName of SOFTWARE_RENDERER_CASES) {
  test(`GameWorld recognizes ${rendererName} as software rendering`, async () => {
    const viewer = await makeViewer({ rendererName });
    const world = new GameWorld(viewer, { ownsArena: false });

    world.start(makeConfig());
    const sun = world.root.children.find((object) => object.isDirectionalLight);

    assert.equal(viewer.renderManager.renderScale, SOFTWARE_RENDER_SCALE);
    assert.equal(sun.castShadow, false);
    world.stop();
    assert.equal(viewer.renderManager.renderScale, 2);
  });
}
