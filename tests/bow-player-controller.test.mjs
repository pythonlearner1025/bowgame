/** Specifies camera-relative movement, sprinting, jumping, and input release. */
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { loadSystem, makeConfig, makeViewer } from './helpers/bow-system-harness.mjs';

const { PlayerController } = await loadSystem('PlayerController');
const { GameState } = await loadSystem('GameState');
const { BowSettings, BOW_SETTINGS_STORAGE_KEY } = await loadSystem('BowSettings');

beforeEach(() => {
  localStorage.removeItem(BOW_SETTINGS_STORAGE_KEY);
});

test('PlayerController converts accepted keys into movement and a legacy jump', async () => {
  const config = makeConfig();
  const state = new GameState(config);
  const viewer = await makeViewer();
  const settings = new BowSettings();
  state.running = true;
  const controller = new PlayerController({
    viewer,
    state,
    world: { collision: null, trails: null },
    bow: {},
    bots: {},
    settings,
    getConfig: () => config,
    callbacks: {
      enter() {},
      restart() {},
      stepRespawn() {},
      getAudio: () => null,
      isOnline: () => false,
      isCapturingKey: () => false,
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
  const settings = new BowSettings();
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
    settings,
    getConfig: () => config,
    callbacks: {
      enter() {},
      restart() {},
      stepRespawn() {},
      getAudio: () => null,
      isOnline: () => false,
      isCapturingKey: () => false,
    },
  });

  controller.step(0.05);

  assert.ok(state.velocity.y > 4);
  assert.equal(state.coyoteSecondsRemaining, 0);
});

test('Inverted mouse movement produces the opposite pitch direction.', async () => {
  const config = makeConfig();
  const state = new GameState(config);
  const viewer = await makeViewer();
  const settings = new BowSettings();
  state.running = true;
  state.active = true;
  const controller = new PlayerController({
    viewer,
    state,
    world: { collision: null, trails: null },
    bow: {},
    bots: {},
    settings,
    getConfig: () => config,
    callbacks: {
      enter() {},
      restart() {},
      stepRespawn() {},
      getAudio: () => null,
      isOnline: () => false,
      isCapturingKey: () => false,
    },
  });
  const movement = {
    movementX: 0,
    movementY: 10,
    buttons: 1,
    stopImmediatePropagation() {},
  };

  controller.onMouseMove(movement);
  const normalPitch = state.pitch;
  state.pitch = 0;
  settings.invertMouseY = true;
  controller.onMouseMove(movement);
  const invertedPitch = state.pitch;

  assert.ok(normalPitch < 0);
  assert.ok(invertedPitch > 0);
  assert.equal(invertedPitch, -normalPitch);
});

test('Mouse sensitivity scales yaw and pitch by the same multiplier.', async () => {
  const config = makeConfig();
  const state = new GameState(config);
  const viewer = await makeViewer();
  const settings = new BowSettings();
  state.running = true;
  state.active = true;
  const controller = new PlayerController({
    viewer,
    state,
    world: { collision: null, trails: null },
    bow: {},
    bots: {},
    settings,
    getConfig: () => config,
    callbacks: {
      enter() {},
      restart() {},
      stepRespawn() {},
      getAudio: () => null,
      isOnline: () => false,
      isCapturingKey: () => false,
    },
  });
  const movement = {
    movementX: 10,
    movementY: 5,
    buttons: 1,
    stopImmediatePropagation() {},
  };

  controller.onMouseMove(movement);
  const defaultYaw = state.yaw;
  const defaultPitch = state.pitch;
  state.yaw = 0;
  state.pitch = 0;
  settings.mouseSensitivity = 2;
  controller.onMouseMove(movement);

  assert.equal(state.yaw, defaultYaw * 2);
  assert.equal(state.pitch, defaultPitch * 2);
});

test('Mouse sensitivity composes with inverted vertical movement.', async () => {
  const config = makeConfig();
  const state = new GameState(config);
  const viewer = await makeViewer();
  const settings = new BowSettings();
  state.running = true;
  state.active = true;
  const controller = new PlayerController({
    viewer,
    state,
    world: { collision: null, trails: null },
    bow: {},
    bots: {},
    settings,
    getConfig: () => config,
    callbacks: {
      enter() {},
      restart() {},
      stepRespawn() {},
      getAudio: () => null,
      isOnline: () => false,
      isCapturingKey: () => false,
    },
  });
  const movement = {
    movementX: 0,
    movementY: 5,
    buttons: 1,
    stopImmediatePropagation() {},
  };

  controller.onMouseMove(movement);
  const defaultPitch = state.pitch;
  state.pitch = 0;
  settings.mouseSensitivity = 2;
  settings.invertMouseY = true;
  controller.onMouseMove(movement);

  assert.equal(state.pitch, defaultPitch * -2);
});

test('A rebound movement key moves the player while its old default no longer does.', async () => {
  const config = makeConfig();
  const state = new GameState(config);
  const viewer = await makeViewer();
  const settings = new BowSettings();
  settings.rebind('moveForward', 'KeyI');
  state.running = true;
  const controller = new PlayerController({
    viewer,
    state,
    world: { collision: null, trails: null },
    bow: {},
    bots: {},
    settings,
    getConfig: () => config,
    callbacks: {
      enter() {},
      restart() {},
      stepRespawn() {},
      getAudio: () => null,
      isOnline: () => false,
      isCapturingKey: () => false,
    },
  });
  const oldKey = {
    code: 'KeyW',
    target: null,
    repeat: false,
    preventDefault() {},
    stopImmediatePropagation() {},
  };
  const reboundKey = {
    code: 'KeyI',
    target: null,
    repeat: false,
    preventDefault() {},
    stopImmediatePropagation() {},
  };

  controller.onKeyDown(oldKey);
  controller.step(1);

  assert.equal(state.player.z, 0);

  controller.onKeyDown(reboundKey);
  controller.step(1);

  assert.equal(state.player.z, -4.5);
});

test('Key capture mode makes PlayerController keydown handling a no-op.', async () => {
  const config = makeConfig();
  const state = new GameState(config);
  const viewer = await makeViewer();
  const settings = new BowSettings();
  state.running = true;
  let wasPrevented = false;
  let wasStopped = false;
  const controller = new PlayerController({
    viewer,
    state,
    world: { collision: null, trails: null },
    bow: {},
    bots: {},
    settings,
    getConfig: () => config,
    callbacks: {
      enter() {},
      restart() {},
      stepRespawn() {},
      getAudio: () => null,
      isOnline: () => false,
      isCapturingKey: () => true,
    },
  });
  const key = {
    code: 'KeyW',
    target: null,
    repeat: false,
    preventDefault() {
      wasPrevented = true;
    },
    stopImmediatePropagation() {
      wasStopped = true;
    },
  };

  controller.onKeyDown(key);

  assert.deepEqual([...state.keys], []);
  assert.equal(wasPrevented, false);
  assert.equal(wasStopped, false);
});
