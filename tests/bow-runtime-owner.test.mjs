/** Specifies one tracked runtime root, world parentage, and stopped-preview restoration. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installBrowserGlobals, makeConfig, makeViewer } from './helpers/bow-system-harness.mjs';

installBrowserGlobals();
const { RuntimeObjectOwner, getTrackedRuntimeObjects } = await import('@blitzdev/engine');
const { Group } = await import('threepipe');
const { GameWorld } = await import('../scripts/GameWorld.js');

test('Runtime ownership tracks one root and GameWorld restores its authored preview', async () => {
  const viewer = await makeViewer();
  const source = new Group();
  source.userData.kite3dAuthoring = { role: 'direct', id: 'bow-demo-arena' };
  viewer.scene.modelRoot.add(source);
  const runtimeRoot = new Group();
  runtimeRoot.name = 'K3D_BOW_RUNTIME';
  const owner = new RuntimeObjectOwner('bow-game:test');
  owner.attachRuntimeRoot(runtimeRoot, viewer.scene, source);
  const world = new GameWorld(viewer, {
    runtimeParent: runtimeRoot,
    authoredPreviewRoot: source,
    ownsArena: false,
  });

  world.start(makeConfig());
  assert.equal(source.visible, false);
  assert.equal(world.root.name, 'K3D_BOW_RUNTIME_WORLD');
  assert.equal(world.root.parent, runtimeRoot);
  assert.deepEqual(getTrackedRuntimeObjects(viewer.scene), [runtimeRoot]);

  world.stop();
  owner.cleanup();
  owner.cleanup();
  assert.equal(source.visible, true);
  assert.equal(runtimeRoot.parent, null);
  assert.deepEqual(getTrackedRuntimeObjects(viewer.scene), []);
});
