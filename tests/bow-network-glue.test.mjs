/** Specifies session event translation and the unchanged 20 Hz state cadence. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadSystem } from './helpers/bow-system-harness.mjs';

const { NetworkGlue } = await loadSystem('NetworkGlue');
const { GameState } = await loadSystem('GameState');
const { Vector3 } = await import('threepipe');

test('NetworkGlue applies welcome state and publishes local state at 20 Hz', () => {
  const state = new GameState();
  const sentStates = [];
  const session = {
    start() {},
    stop() {},
    onChange(listener) {
      this.listener = listener;

      return () => {};
    },
    sendState(value) {
      sentStates.push(value);
    },
    getName: () => 'ARCHER',
    setName() {},
  };
  const glue = new NetworkGlue(state, session, {
    getSlotSpawn: () => new Vector3(3, 0, 4),
    syncRemotePlayers() {},
    spawnArrow() {},
    applyNetworkHit() {},
    addDeath() {},
    setRemoteDead() {},
    resetOnlineRound() {},
    updateHud() {},
  });
  const snapshot = {
    status: 'connected',
    playerId: 'local',
    players: [
      {
        id: 'local',
        name: 'ARCHER',
        slot: 0,
        local: true,
        seq: 0,
        pos: { x: 0, y: 0, z: 0 },
        yaw: 0,
        pitch: 0,
        draw: 0,
        anim: 'ready',
        deaths: 2,
      },
    ],
    scores: { local: 4 },
    scoreLimit: 20,
    round: 1,
    winnerId: null,
    latencyMs: null,
  };

  glue.onMessage({ type: 'welcome', playerId: 'local', slot: 0 }, snapshot);
  glue.step(0.049);
  glue.step(0.001);

  assert.deepEqual(state.player.toArray(), [3, 0, 4]);
  assert.equal(state.kills, 4);
  assert.equal(state.deaths, 2);
  assert.equal(sentStates.length, 1);
  assert.equal(sentStates[0].seq, 1);
});
