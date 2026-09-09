/** Specifies projectile launch speed, swept player hits, and impact state. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadSystem, makeConfig } from './helpers/bow-system-harness.mjs';

const { ArrowSystem } = await loadSystem('ArrowSystem');
const { GameState } = await loadSystem('GameState');
const { Group, Vector3 } = await import('threepipe');

test('ArrowSystem sweeps a bot arrow through the local body volume exactly once', () => {
  const config = makeConfig();
  const state = new GameState(config);
  const impacts = [];
  const system = new ArrowSystem(
    state,
    { root: new Group(), collision: null, trails: null },
    () => config,
    {
      getAudio: () => null,
      getRemoteCandidates: () => [],
      applyDamage: (...values) => impacts.push(values),
      sendShot() {},
      sendHit() {},
      isOnline: () => false,
    },
  );

  system.fire(new Vector3(0, 1.05, -3), new Vector3(0, 0, 1), 0, 1);
  for (let i = 0; i < 20; i++) {
    system.step(1 / 120);
  }

  assert.equal(impacts.length, 1);
  assert.deepEqual(impacts[0], [-1, 70, 0, false]);
  assert.equal(state.arrows[0].stuck, true);
  assert.equal(state.arrows[0].mesh.visible, false);
});
