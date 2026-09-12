/** Specifies durable mouse preferences and conflict-free player key bindings. */
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { FakeElement, loadSystem } from './helpers/bow-system-harness.mjs';

const {
  BowSettings,
  BOW_SETTINGS_STORAGE_KEY,
  MAX_MOUSE_SENSITIVITY_MULTIPLIER,
  MIN_MOUSE_SENSITIVITY_MULTIPLIER,
} = await loadSystem('BowSettings');
const { SettingsPanel } = await loadSystem('SettingsPanel');

const TEST_MOUSE_SENSITIVITY_MULTIPLIER = 1.75;

beforeEach(() => {
  localStorage.removeItem(BOW_SETTINGS_STORAGE_KEY);
});

test('BowSettings defaults reproduce every original hard-coded key binding.', () => {
  const settings = new BowSettings();

  const bindings = {
    moveForward: settings.getBinding('moveForward'),
    moveBack: settings.getBinding('moveBack'),
    moveLeft: settings.getBinding('moveLeft'),
    moveRight: settings.getBinding('moveRight'),
    sprint: settings.getBinding('sprint'),
    jump: settings.getBinding('jump'),
    restart: settings.getBinding('restart'),
    mute: settings.getBinding('mute'),
  };

  assert.deepEqual(bindings, {
    moveForward: ['KeyW', 'ArrowUp'],
    moveBack: ['KeyS', 'ArrowDown'],
    moveLeft: ['KeyA', 'ArrowLeft'],
    moveRight: ['KeyD', 'ArrowRight'],
    sprint: ['ShiftLeft', 'ShiftRight'],
    jump: ['Space'],
    restart: ['KeyR'],
    mute: ['KeyM'],
  });
  assert.equal(settings.invertMouseY, false);
  assert.equal(settings.mouseSensitivity, 1);
});

test('The mouse sensitivity preference survives a save and read round-trip.', () => {
  const settings = new BowSettings();

  settings.mouseSensitivity = TEST_MOUSE_SENSITIVITY_MULTIPLIER;
  const restoredSettings = new BowSettings();

  assert.equal(restoredSettings.mouseSensitivity, TEST_MOUSE_SENSITIVITY_MULTIPLIER);
});

test('Stored mouse sensitivity above the maximum clamps to the supported range.', () => {
  localStorage.setItem(
    BOW_SETTINGS_STORAGE_KEY,
    JSON.stringify({ mouseSensitivity: MAX_MOUSE_SENSITIVITY_MULTIPLIER + 1 }),
  );

  const settings = new BowSettings();

  assert.equal(settings.mouseSensitivity, MAX_MOUSE_SENSITIVITY_MULTIPLIER);
});

test('Stored mouse sensitivity below the minimum clamps to the supported range.', () => {
  localStorage.setItem(
    BOW_SETTINGS_STORAGE_KEY,
    JSON.stringify({ mouseSensitivity: MIN_MOUSE_SENSITIVITY_MULTIPLIER / 2 }),
  );

  const settings = new BowSettings();

  assert.equal(settings.mouseSensitivity, MIN_MOUSE_SENSITIVITY_MULTIPLIER);
});

test('A non-numeric mouse sensitivity leaves other stored preferences intact.', () => {
  localStorage.setItem(
    BOW_SETTINGS_STORAGE_KEY,
    JSON.stringify({
      bindings: { jump: ['KeyJ'] },
      invertMouseY: true,
      mouseSensitivity: 'fast',
    }),
  );

  const settings = new BowSettings();

  assert.equal(settings.mouseSensitivity, 1);
  assert.equal(settings.invertMouseY, true);
  assert.deepEqual(settings.getBinding('jump'), ['KeyJ']);
});

test('A non-finite mouse sensitivity leaves other stored preferences intact.', () => {
  localStorage.setItem(
    BOW_SETTINGS_STORAGE_KEY,
    '{"bindings":{"jump":["KeyJ"]},"invertMouseY":true,"mouseSensitivity":1e400}',
  );

  const settings = new BowSettings();

  assert.equal(settings.mouseSensitivity, 1);
  assert.equal(settings.invertMouseY, true);
  assert.deepEqual(settings.getBinding('jump'), ['KeyJ']);
});

test('Saved key bindings can be read by a later BowSettings instance.', () => {
  const settings = new BowSettings();

  settings.rebind('jump', 'KeyJ');
  const restoredSettings = new BowSettings();

  assert.deepEqual(restoredSettings.getBinding('jump'), ['KeyJ']);
  assert.equal(restoredSettings.isBoundCode('Space'), false);
});

test('Corrupt settings JSON falls back to every default without throwing.', () => {
  localStorage.setItem(BOW_SETTINGS_STORAGE_KEY, '{broken');

  const settings = new BowSettings();

  assert.deepEqual(settings.getBinding('moveForward'), ['KeyW', 'ArrowUp']);
  assert.deepEqual(settings.getBinding('jump'), ['Space']);
  assert.equal(settings.invertMouseY, false);
});

test('One invalid stored field keeps other valid preferences intact.', () => {
  localStorage.setItem(
    BOW_SETTINGS_STORAGE_KEY,
    JSON.stringify({
      bindings: {
        moveForward: ['KeyI'],
        jump: [],
        restart: [null],
        unknownAction: ['KeyU'],
      },
      invertMouseY: true,
    }),
  );

  const settings = new BowSettings();

  assert.deepEqual(settings.getBinding('moveForward'), ['KeyI']);
  assert.deepEqual(settings.getBinding('jump'), ['Space']);
  assert.deepEqual(settings.getBinding('restart'), ['KeyR']);
  assert.equal(settings.isBoundCode('KeyU'), false);
  assert.equal(settings.invertMouseY, true);
});

test('Rebinding removes the selected code from the action that previously held it.', () => {
  const settings = new BowSettings();

  settings.rebind('moveBack', 'KeyW');

  assert.deepEqual(settings.getBinding('moveBack'), ['KeyW']);
  assert.deepEqual(settings.getBinding('moveForward'), ['ArrowUp']);
});

test('Moving a sole binding to another action can leave the first action unbound.', () => {
  const settings = new BowSettings();

  settings.rebind('jump', 'KeyR');
  const restoredSettings = new BowSettings();

  assert.deepEqual(settings.getBinding('jump'), ['KeyR']);
  assert.deepEqual(settings.getBinding('restart'), []);
  assert.deepEqual(restoredSettings.getBinding('restart'), []);
});

test('Resetting settings restores all original keys and mouse direction.', () => {
  const settings = new BowSettings();
  settings.rebind('moveForward', 'KeyI');
  settings.invertMouseY = true;
  settings.mouseSensitivity = 2;

  settings.resetDefaults();

  assert.deepEqual(settings.getBinding('moveForward'), ['KeyW', 'ArrowUp']);
  assert.deepEqual(settings.getBinding('sprint'), ['ShiftLeft', 'ShiftRight']);
  assert.equal(settings.invertMouseY, false);
  assert.equal(settings.mouseSensitivity, 1);
});

test('The inverted-mouse preference survives a save and read round-trip.', () => {
  const settings = new BowSettings();

  settings.invertMouseY = true;
  const restoredSettings = new BowSettings();

  assert.equal(restoredSettings.invertMouseY, true);
});

test('Unavailable browser storage never prevents settings reads or mutations.', () => {
  const availableStorage = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new Error('blocked');
    },
  });

  try {
    const settings = new BowSettings();

    assert.doesNotThrow(() => settings.rebind('jump', 'KeyJ'));
    assert.doesNotThrow(() => {
      settings.invertMouseY = true;
    });
    assert.doesNotThrow(() => {
      settings.mouseSensitivity = 2;
    });
    assert.deepEqual(settings.getBinding('jump'), ['KeyJ']);
    assert.equal(settings.invertMouseY, true);
    assert.equal(settings.mouseSensitivity, 2);
  } finally {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: availableStorage,
      writable: true,
    });
  }
});

test('SettingsPanel exposes readable, accessible modal controls without rebuilding them.', () => {
  const settings = new BowSettings();
  const panel = new SettingsPanel(settings);
  const modal = new FakeElement();

  panel.start(modal);
  const toggle = modal.children[0];
  const body = modal.children[1];
  const checkbox = body.children[0].children[0];
  const moveForwardButton = body.children[2].children[1];
  toggle.click();
  checkbox.checked = true;
  checkbox.onchange();

  assert.equal(toggle.getAttribute('aria-label'), 'Toggle settings panel');
  assert.equal(body.style.values.get('display'), 'block');
  assert.equal(checkbox.getAttribute('aria-label'), 'Invert mouse Y axis');
  assert.equal(settings.invertMouseY, true);
  assert.equal(moveForwardButton.textContent, 'W / Up');
  assert.equal(moveForwardButton.getAttribute('aria-label').includes('Rebind Move forward'), true);
});

test('SettingsPanel previews mouse sensitivity without saving until change.', () => {
  const settings = new BowSettings();
  const panel = new SettingsPanel(settings);
  const modal = new FakeElement();
  panel.start(modal);
  const sensitivityControl = modal.children[1].children[1];
  const readout = sensitivityControl.children[0].children[1];
  const input = sensitivityControl.children[1];

  input.value = String(TEST_MOUSE_SENSITIVITY_MULTIPLIER);
  input.oninput();

  assert.equal(input.type, 'range');
  assert.equal(input.min, '0.25');
  assert.equal(input.max, '3');
  assert.equal(input.step, '0.05');
  assert.equal(input.getAttribute('aria-label'), 'Mouse sensitivity');
  assert.equal(input.getAttribute('aria-valuetext'), '1.75×');
  assert.equal(readout.textContent, '1.75×');
  assert.equal(settings.mouseSensitivity, 1);
  assert.equal(localStorage.getItem(BOW_SETTINGS_STORAGE_KEY), null);

  input.onchange();

  assert.equal(settings.mouseSensitivity, TEST_MOUSE_SENSITIVITY_MULTIPLIER);
  assert.equal(
    JSON.parse(localStorage.getItem(BOW_SETTINGS_STORAGE_KEY)).mouseSensitivity,
    TEST_MOUSE_SENSITIVITY_MULTIPLIER,
  );
});

test('SettingsPanel reset visibly restores the default mouse sensitivity.', () => {
  const settings = new BowSettings();
  const panel = new SettingsPanel(settings);
  const modal = new FakeElement();
  panel.start(modal);
  const body = modal.children[1];
  const sensitivityControl = body.children[1];
  const readout = sensitivityControl.children[0].children[1];
  const input = sensitivityControl.children[1];
  const reset = body.children[body.children.length - 1];
  input.value = '2';
  input.onchange();

  reset.click();

  assert.equal(input.value, '1');
  assert.equal(readout.textContent, '1.00×');
  assert.equal(input.getAttribute('aria-valuetext'), '1.00×');
});

test('SettingsPanel captures one key and lets Escape cancel without rebinding.', () => {
  const settings = new BowSettings();
  const panel = new SettingsPanel(settings);
  const modal = new FakeElement();
  panel.start(modal);
  const moveForwardButton = modal.children[1].children[2].children[1];
  const escape = {
    code: 'Escape',
    preventDefault() {},
    stopImmediatePropagation() {},
  };
  const replacement = {
    code: 'KeyI',
    preventDefault() {},
    stopImmediatePropagation() {},
  };

  moveForwardButton.click();
  panel.onKeyDown(escape);

  assert.deepEqual(settings.getBinding('moveForward'), ['KeyW', 'ArrowUp']);
  assert.equal(panel.isCapturingKey(), false);

  moveForwardButton.click();
  assert.equal(moveForwardButton.textContent, 'PRESS A KEY');
  panel.onKeyDown(replacement);

  assert.deepEqual(settings.getBinding('moveForward'), ['KeyI']);
  assert.equal(panel.isCapturingKey(), false);
  assert.equal(moveForwardButton.textContent, 'I');
});
