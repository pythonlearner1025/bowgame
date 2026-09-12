/** Specifies player-name entry, pointer-lock activation, and cached modal writes. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FakeElement, loadSystem, makeConfig, makeViewer } from './helpers/bow-system-harness.mjs';

const { EntryOverlay } = await loadSystem('EntryOverlay');
const { GameState } = await loadSystem('GameState');
const { BowSettings } = await loadSystem('BowSettings');

test('EntryOverlay saves a clean name and activates a connected player', async () => {
  const state = new GameState(makeConfig());
  state.sounds = { resume: () => Promise.resolve() };
  const viewer = await makeViewer();
  const settings = new BowSettings();
  const names = [];
  const entry = new EntryOverlay(viewer, state, () => makeConfig(), {
    settings,
    isOnline: () => false,
    isConnected: () => true,
    getNetworkName: () => null,
    setNetworkName: (name) => names.push(name),
    restart() {},
  });
  const overlay = new FakeElement();
  entry.start(overlay);
  const input = overlay.children[0].children[2].children[0];
  input.value = '  Robin\nHood  ';

  entry.enter();

  assert.equal(state.playerName, 'RobinHood');
  assert.deepEqual(names, ['RobinHood']);
  assert.equal(state.active, true);
  assert.equal(document.pointerLockElement, viewer.canvas);
});

test('EntryOverlay mounts BOWGAME settings beneath the existing modal buttons.', async () => {
  const state = new GameState(makeConfig());
  const viewer = await makeViewer();
  const settings = new BowSettings();
  const entry = new EntryOverlay(viewer, state, () => makeConfig(), {
    settings,
    isOnline: () => false,
    isConnected: () => true,
    getNetworkName: () => null,
    setNetworkName() {},
    restart() {},
  });
  const overlay = new FakeElement();

  entry.start(overlay);
  const modal = overlay.children[0];
  const settingsToggle = modal.children.find((element) => element.dataset.hud === 'settingsToggle');
  const settingsPanel = modal.children.find((element) => element.dataset.hud === 'settingsPanel');
  settingsToggle.click();

  assert.equal(modal.children[0].textContent, 'BOWGAME');
  assert.equal(settingsToggle.textContent, 'SETTINGS');
  assert.equal(settingsPanel.style.values.get('display'), 'block');
});
