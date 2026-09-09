/** Specifies optional seven-day player-name persistence behavior. */
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  clearPlayerName,
  PLAYER_NAME_STORAGE_KEY,
  readPlayerName,
  sanitizePlayerNameInput,
  savePlayerName,
  SEVEN_DAYS_MS,
} from '../scripts/BowPlayerName.js';

function installStorage() {
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };

  return values;
}

afterEach(() => {
  delete globalThis.localStorage;
});

test('An explicitly chosen name remains saved for seven days without extending on reads.', () => {
  const values = installStorage();
  const nowMs = 1_000;

  assert.equal(savePlayerName('  Rust Hunter  ', nowMs), 'Rust Hunter');
  const savedRecord = values.get(PLAYER_NAME_STORAGE_KEY);
  assert.equal(readPlayerName(nowMs + SEVEN_DAYS_MS - 1), 'Rust Hunter');
  assert.equal(values.get(PLAYER_NAME_STORAGE_KEY), savedRecord);
  assert.equal(readPlayerName(nowMs + SEVEN_DAYS_MS), null);
  assert.equal(values.has(PLAYER_NAME_STORAGE_KEY), false);
});

test('Replacing a saved name starts a new period and clearing removes the record.', () => {
  installStorage();

  savePlayerName('First', 100);
  savePlayerName('Second', 500);

  assert.equal(readPlayerName(100 + SEVEN_DAYS_MS), 'Second');
  clearPlayerName();
  assert.equal(readPlayerName(501), null);
});

test('Names remove controls, use protocol bounds, and tolerate unavailable storage.', () => {
  const values = installStorage();

  assert.equal(sanitizePlayerNameInput(' A\nB\u007f '), 'AB');
  assert.equal(savePlayerName(' A\nB '.repeat(20)).length, 24);
  values.set(PLAYER_NAME_STORAGE_KEY, 'broken');
  assert.equal(readPlayerName(), null);
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new Error('blocked');
    },
  });

  assert.equal(readPlayerName(), null);
  assert.equal(savePlayerName('Hunter'), 'Hunter');
  assert.doesNotThrow(clearPlayerName);
});
