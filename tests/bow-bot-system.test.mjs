/** Specifies solo bot population creation, spawn recovery, and score-preserving reset. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadSystem, makeConfig } from './helpers/bow-system-harness.mjs';

const { BotSystem } = await loadSystem('BotSystem');
const { GameState } = await loadSystem('GameState');
const { Group } = await import('threepipe');

test('BotSystem creates configured solo bots and restores their spawn state', () => {
  const config = makeConfig();
  const state = new GameState(config);
  const system = new BotSystem(state, { root: new Group(), collision: null }, () => config, {
    fire() {},
  });

  system.start(false);
  state.bots[0].kills = 3;
  state.bots[0].deaths = 2;
  state.bots[0].hp = 0;
  system.spawn(state.bots[0], 0);

  assert.equal(state.bots.length, 1);
  assert.equal(state.bots[0].name, 'ASH');
  assert.equal(state.bots[0].hp, 100);
  assert.equal(state.bots[0].kills, 3);
  assert.deepEqual(state.bots[0].mesh.position.toArray(), [-4, 0, 6]);
  system.start(true);
  assert.deepEqual(state.bots, []);
});
