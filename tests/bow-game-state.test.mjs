/** Specifies mutable simulation state defaults and round reset behavior. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadSystem, makeConfig } from './helpers/bow-system-harness.mjs';

const { GameState } = await loadSystem('GameState');

test('GameState resets transient round values without discarding lifetime score', () => {
  const state = new GameState(makeConfig());
  state.kills = 7;
  state.hp = 12;
  state.winner = 'ASH';
  state.drawing = true;
  state.charge = 0.75;
  state.deathFeed = [{ killer: 'ASH', victim: 'YOU', expiresAtSeconds: 9 }];

  state.resetRoundValues();

  assert.equal(state.hp, 100);
  assert.equal(state.winner, '');
  assert.equal(state.drawing, false);
  assert.equal(state.charge, 0);
  assert.deepEqual(state.deathFeed, []);
  assert.equal(state.kills, 7);
});
