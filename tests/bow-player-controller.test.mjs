/** Specifies camera-relative movement, sprinting, jumping, and input release. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadSystem, makeConfig, makeViewer } from './helpers/bow-system-harness.mjs';

const { PlayerController } = await loadSystem('PlayerController');
const { GameState } = await loadSystem('GameState');

test('PlayerController converts accepted keys into movement and a legacy jump', async () => {
  const config = makeConfig();
  const state = new GameState(config);
  const viewer = await makeViewer();
  state.running = true;
  const controller = new PlayerController({
    viewer,
    state,
    world: { collision: null, trails: null },
    bow: {},
    bots: {},
    getConfig: () => config,
    callbacks: {
      enter() {},
      restart() {},
      stepRespawn() {},
      getAudio: () => null,
      isOnline: () => false,
    },
  });
  const key = {
    code: 'KeyW',
    target: null,
    repeat: false,
    preventDefault() {},
    stopImmediatePropagation() {},
  };

  controller.onKeyDown(key);
  controller.step(1);
  controller.onKeyUp(key);
  state.keys.add('Space');
  controller.step(0.1);

  assert.equal(state.player.z, -4.5);
  assert.ok(state.player.y > 0);
  assert.equal(state.keys.has('KeyW'), false);
});

test('PlayerController preserves the collision coyote window after support is lost', async () => {
  const config = makeConfig();
  const state = new GameState(config);
  const viewer = await makeViewer();
  state.running = true;
  state.coyoteSecondsRemaining = 0.1;
  state.keys.add('Space');
  const controller = new PlayerController({
    viewer,
    state,
    world: {
      collision: {
        hasSupport: () => false,
        move: () => false,
      },
      trails: null,
    },
    bow: {},
    bots: {},
    getConfig: () => config,
    callbacks: {
      enter() {},
      restart() {},
      stepRespawn() {},
      getAudio: () => null,
      isOnline: () => false,
    },
  });

  controller.step(0.05);

  assert.ok(state.velocity.y > 4);
  assert.equal(state.coyoteSecondsRemaining, 0);
});
