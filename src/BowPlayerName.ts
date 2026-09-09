/**
 * Owns optional seven-day player-name persistence and temporary random display names.
 * It does not manage form controls, networking, or player identity.
 */
import { cleanPlayerName } from './BowProtocol.js';

// Seven days balances convenience with avoiding indefinite browser identity storage.
export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1_000;

// Versioning the key permits future storage formats without misreading older records.
export const PLAYER_NAME_STORAGE_KEY = 'bowgame.player-name.v1';

// Four decimal digits keep temporary names compact in the leaderboard.
const RANDOM_NAME_RANGE = 10_000;
const RANDOM_NAME_DIGITS = 4;

// ASCII codes below space are the C0 control range.
const FIRST_VISIBLE_CHARACTER_CODE = 32;

// ASCII DEL is the remaining control character outside the C0 range.
const DELETE_CHARACTER_CODE = 127;

interface PlayerNameRecord {
  name: string;
  expiresAt: number;
}

function isPlayerNameRecord(value: unknown): value is PlayerNameRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return typeof record.name === 'string' && Number.isFinite(record.expiresAt);
}

function removeStoredPlayerName(): void {
  try {
    localStorage.removeItem(PLAYER_NAME_STORAGE_KEY);
  } catch (error: unknown) {
    console.warn('Stored player name could not be removed.', { error });
  }
}

/**
 * Removes ASCII control characters before deciding whether an entry was explicitly named.
 *
 * @param value - Raw value from the player-name field.
 * @returns A trimmed, protocol-safe name or an empty string when no visible name was entered.
 */
export function sanitizePlayerNameInput(value: string): string {
  // C0 controls and DEL are removed because they could create invisible or multiline HUD names.
  const withoutControlCharacters = Array.from(value)
    .filter((character) => {
      const characterCode = character.charCodeAt(0);

      return (
        characterCode >= FIRST_VISIBLE_CHARACTER_CODE && characterCode !== DELETE_CHARACTER_CODE
      );
    })
    .join('')
    .trim();

  if (!withoutControlCharacters) {
    return '';
  }

  return cleanPlayerName(withoutControlCharacters);
}

/**
 * Reads a non-expired saved player name without extending its expiry.
 *
 * @param nowMs - Current Unix time in milliseconds, injectable for deterministic tests.
 * @returns The saved protocol-safe name, or null when missing, invalid, expired, or unavailable.
 * Removes malformed or expired records when storage is available.
 */
export function readPlayerName(nowMs = Date.now()): string | null {
  try {
    const rawRecord = localStorage.getItem(PLAYER_NAME_STORAGE_KEY);

    if (!rawRecord) {
      return null;
    }

    const record: unknown = JSON.parse(rawRecord);

    if (isPlayerNameRecord(record) && record.expiresAt > nowMs) {
      const name = sanitizePlayerNameInput(record.name);

      if (name) {
        return name;
      }
    }

    removeStoredPlayerName();
  } catch (error: unknown) {
    console.warn('Stored player name could not be read.', { error });
  }

  return null;
}

/**
 * Saves an explicitly chosen player name for seven days from this write.
 *
 * @param value - Raw value explicitly entered by the player.
 * @param nowMs - Current Unix time in milliseconds, injectable for deterministic tests.
 * @returns The protocol-safe display name used for the current session.
 * Attempts a localStorage write without allowing storage failures to block play.
 */
export function savePlayerName(value: string, nowMs = Date.now()): string {
  const name = sanitizePlayerNameInput(value) || cleanPlayerName(value);
  const record: PlayerNameRecord = { name, expiresAt: nowMs + SEVEN_DAYS_MS };

  try {
    localStorage.setItem(PLAYER_NAME_STORAGE_KEY, JSON.stringify(record));
  } catch (error: unknown) {
    console.warn('Player name could not be saved.', { error });
  }

  return name;
}

/**
 * Clears the saved player name when browser storage is available.
 *
 * @returns Nothing.
 * Attempts a localStorage removal without allowing storage failures to block play.
 */
export function clearPlayerName(): void {
  removeStoredPlayerName();
}

/**
 * Creates a temporary display name that is never persisted by this module.
 *
 * @returns A compact random name in the form `Archer-0000`.
 */
export function randomPlayerName(): string {
  const randomValue = new Uint16Array(1);
  crypto.getRandomValues(randomValue);

  return `Archer-${String(randomValue[0] % RANDOM_NAME_RANGE).padStart(RANDOM_NAME_DIGITS, '0')}`;
}
