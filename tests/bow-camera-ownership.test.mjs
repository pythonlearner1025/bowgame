/** Specifies that the running player controller is the only writer of the viewer camera. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadSystem, makeConfig, makeViewer } from './helpers/bow-system-harness.mjs';

const { PlayerController } = await loadSystem('PlayerController');
const { GameState } = await loadSystem('GameState');
const { BowSettings } = await loadSystem('BowSettings');
const { Vector3 } = await import('threepipe');

/**
 * Builds a started controller over a viewer whose camera still carries orbit controls.
 *
 * @returns The controller, its state, and the viewer camera under test.
 */
async function startedController() {
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
    bow: { updateViewModel() {}, hideViewModel() {} },
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
  controller.start();

  return { controller, state, camera: viewer.scene.mainCamera };
}

test('Starting play takes the camera off orbit controls and stopping gives it back', async () => {
  const { controller, camera } = await startedController();

  assert.equal(camera.controlsMode, '', 'play must leave no controls attached to the camera');

  controller.stop();

  assert.equal(camera.controlsMode, 'orbit', 'stopping must restore the authored controls mode');
});

test('A frame the runtime skips renders the previous camera instead of an orbit flip', async () => {
  const { controller, state, camera } = await startedController();
  // Threepipe calls controls.update() every postFrame while a controls mode is set. Three's
  // OrbitControls.update() aims the camera at its own target and ignores controls.enabled.
  const controls = { enabled: false, target: new Vector3(0, 0, 0), updates: 0 };
  controls.update = () => {
    controls.updates++;
    camera.lookAt(controls.target);
  };
  camera.controls = controls;
  state.keys.add('KeyW');

  const SKIPPED_FRAME = 3;
  const rendered = [];

  for (let frame = 0; frame < 6; frame++) {
    // The runtime skips its update on a progressive frame; the viewer still renders that frame.
    if (frame !== SKIPPED_FRAME) {
      controller.step(0.05);
      controller.updateCamera();
    }

    rendered.push(camera.quaternion.clone());

    if (camera.controlsMode !== '') {
      controls.update();
    }
  }

  const flip = rendered[SKIPPED_FRAME].angleTo(rendered[SKIPPED_FRAME - 1]);
  assert.ok(
    flip < 1e-6,
    `a skipped frame must reuse the last camera, but it turned ${((flip * 180) / Math.PI).toFixed(1)} degrees`,
  );
  assert.equal(controls.updates, 0, 'detached controls must never run');
});

test('Stopping restores the camera when the viewer never had controls', async () => {
  const config = makeConfig();
  const state = new GameState(config);
  const viewer = await makeViewer();
  const settings = new BowSettings();
  const camera = viewer.scene.mainCamera;
  delete camera.controls;
  camera.controlsMode = '';
  state.running = true;
  const controller = new PlayerController({
    viewer,
    state,
    world: { collision: null, trails: null },
    bow: { updateViewModel() {}, hideViewModel() {} },
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

  controller.start();

  assert.equal(camera.controlsMode, '');

  controller.stop();

  assert.equal(camera.controlsMode, '', 'a camera with no controls must stay without controls');
});
