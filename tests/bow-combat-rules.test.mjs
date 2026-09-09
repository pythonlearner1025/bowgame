/** Specifies damage, death records, scores, and the solo win condition. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadSystem, makeConfig } from './helpers/bow-system-harness.mjs';

const { CombatRules } = await loadSystem('CombatRules');
const { GameState } = await loadSystem('GameState');
const { Group, Vector3 } = await import('threepipe');

test('CombatRules awards a local elimination and ends the match at the score limit', () => {
  const config = makeConfig();
  const state = new GameState(config);
  const bot = { name: 'ASH', hp: 60, deaths: 0, kills: 0, respawn: 0, mesh: new Group() };
  state.bots = [bot];
  const rules = new CombatRules(
    state,
    () => config,
    () => false,
    {
      getAudio: () => null,
      getSlotSpawn: () => new Vector3(),
      spawnBot() {},
      clearArrows() {},
      resetRemotePlayers() {},
      sendDeath() {},
      updateCamera() {},
    },
  );

  rules.damage(0, 60, -1, true);

  assert.equal(bot.hp, 0);
  assert.equal(bot.deaths, 1);
  assert.equal(state.kills, 1);
  assert.equal(state.winner, 'YOU');
  assert.deepEqual(
    state.deathFeed.map(({ killer, victim }) => ({ killer, victim })),
    [{ killer: 'YOU', victim: 'ASH' }],
  );
});
