/** Specifies bow draw, charge, release, cooldown, and cancel transitions. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadSystem, makeConfig, makeViewer } from './helpers/bow-system-harness.mjs';

const { BowController } = await loadSystem('BowController');
const { GameState } = await loadSystem('GameState');
const { Group } = await import('threepipe');

test('BowController fires charged draws and lowers partial draws without a shot', async () => {
  const state = new GameState(makeConfig());
  const viewer = await makeViewer();
  const shots = [];
  const bow = new BowController({
    viewer,
    state,
    world: { root: new Group() },
    arrows: { fire: (...values) => shots.push(values) },
    callbacks: { updateCamera() {}, getAudio: () => null },
  });
  const primary = { button: 0 };

  bow.handleMouseDown(primary);
  bow.stepCharge(0.7);
  bow.handleMouseUp(primary);

  assert.equal(shots.length, 1);
  assert.equal(state.drawing, false);
  assert.equal(state.charge, 0);
  assert.ok(state.cooldown > 0);
  bow.stepTransitions(1);
  bow.handleMouseDown(primary);
  bow.stepCharge(0.1);
  bow.handleMouseUp(primary);
  assert.equal(shots.length, 1);
  assert.equal(state.cancelTime, 0);
});
