/** Specifies remote interpolation, hit candidates, death hiding, and round reset. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadSystem } from './helpers/bow-system-harness.mjs';

const { RemotePlayers } = await loadSystem('RemotePlayers');
const { GameState } = await loadSystem('GameState');
const { Group, Vector3 } = await import('threepipe');

test('RemotePlayers interpolates targets and excludes the relayed shooter from hits', () => {
  const state = new GameState();
  const player = {
    id: 'remote-1',
    slot: 1,
    mesh: new Group(),
    target: new Vector3(10, 0, 0),
    targetYaw: 1,
    targetDraw: 1,
    draw: 0,
    anim: 'walk',
    phase: 0,
    release: -1,
    hp: 100,
  };
  state.remotePlayers.set(player.id, player);
  const remotes = new RemotePlayers(
    state,
    { root: new Group() },
    { updatePose() {} },
    () => new Vector3(4, 0, -6),
  );

  remotes.step(0.1);

  assert.ok(player.mesh.position.x > 0 && player.mesh.position.x < 10);
  assert.equal(remotes.getHitCandidates('remote-1').length, 0);
  assert.equal(remotes.getHitCandidates().length, 1);
  remotes.setDead('remote-1');
  assert.equal(player.mesh.visible, false);
  remotes.resetRound();
  assert.equal(player.hp, 100);
  assert.equal(player.mesh.visible, true);
  assert.deepEqual(player.target.toArray(), [4, 0, -6]);
});
