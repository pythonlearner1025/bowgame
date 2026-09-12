/**
 * Owns durable player preferences and action-to-key bindings.
 * It does not own DOM controls, browser input listeners, or simulation behavior.
 */

/** Every player action that can be rebound through the settings panel. */
export type BowAction =
  'moveForward' | 'moveBack' | 'moveLeft' | 'moveRight' | 'sprint' | 'jump' | 'restart' | 'mute';

/** Stable action order shared by persistence and settings presentation. */
export const BOW_ACTIONS: readonly BowAction[] = [
  'moveForward',
  'moveBack',
  'moveLeft',
  'moveRight',
  'sprint',
  'jump',
  'restart',
  'mute',
];

/** Versioned browser key for durable, non-identity player preferences. */
export const BOW_SETTINGS_STORAGE_KEY = 'bowgame.settings.v1';

/** Minimum multiplier controls the slowest supported mouse-look response. */
export const MIN_MOUSE_SENSITIVITY_MULTIPLIER = 0.25;

/** Maximum multiplier controls the fastest supported mouse-look response. */
export const MAX_MOUSE_SENSITIVITY_MULTIPLIER = 3;

/** Default multiplier controls the unchanged original mouse-look response. */
export const DEFAULT_MOUSE_SENSITIVITY_MULTIPLIER = 1;

type ActionBindings = Record<BowAction, string[]>;

interface BowSettingsRecord {
  bindings?: unknown;
  invertMouseY?: unknown;
  mouseSensitivity?: unknown;
  unboundActions?: unknown;
}

const DEFAULT_BINDINGS: Readonly<Record<BowAction, readonly string[]>> = {
  moveForward: ['KeyW', 'ArrowUp'],
  moveBack: ['KeyS', 'ArrowDown'],
  moveLeft: ['KeyA', 'ArrowLeft'],
  moveRight: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  jump: ['Space'],
  restart: ['KeyR'],
  mute: ['KeyM'],
};

function isBowSettingsRecord(value: unknown): value is BowSettingsRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBindingRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyCodeList(value: unknown): value is string[] {
  if (!Array.isArray(value) || value.length === 0) {
    return false;
  }

  return value.every((code) => typeof code === 'string' && code.length > 0);
}

function createDefaultBindings(): ActionBindings {
  return {
    moveForward: [...DEFAULT_BINDINGS.moveForward],
    moveBack: [...DEFAULT_BINDINGS.moveBack],
    moveLeft: [...DEFAULT_BINDINGS.moveLeft],
    moveRight: [...DEFAULT_BINDINGS.moveRight],
    sprint: [...DEFAULT_BINDINGS.sprint],
    jump: [...DEFAULT_BINDINGS.jump],
    restart: [...DEFAULT_BINDINGS.restart],
    mute: [...DEFAULT_BINDINGS.mute],
  };
}

function readBindings(value: unknown): ActionBindings {
  const bindings = createDefaultBindings();

  if (!isBindingRecord(value)) {
    return bindings;
  }

  for (const action of BOW_ACTIONS) {
    const storedCodes = value[action];

    if (isNonEmptyCodeList(storedCodes)) {
      bindings[action] = [...new Set(storedCodes)];
    }
  }

  return bindings;
}

function readUnboundActions(value: unknown): BowAction[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (action): action is BowAction =>
      typeof action === 'string' && BOW_ACTIONS.includes(action as BowAction),
  );
}

function removeBindingConflicts(bindings: ActionBindings): void {
  const claimedCodes = new Set<string>();

  for (const action of BOW_ACTIONS) {
    bindings[action] = bindings[action].filter((code) => {
      if (claimedCodes.has(code)) {
        return false;
      }

      claimedCodes.add(code);

      return true;
    });
  }
}

function clampMouseSensitivity(value: number): number {
  return Math.max(
    MIN_MOUSE_SENSITIVITY_MULTIPLIER,
    Math.min(MAX_MOUSE_SENSITIVITY_MULTIPLIER, value),
  );
}

/** Provides defensive persistence and conflict-free action bindings for one runtime. */
export class BowSettings {
  private bindings: ActionBindings = createDefaultBindings();
  private isMouseYInverted = false;
  private mouseSensitivityMultiplier = DEFAULT_MOUSE_SENSITIVITY_MULTIPLIER;

  /** Loads saved preferences when browser storage is present and valid. */
  constructor() {
    this.readStoredSettings();
  }

  /**
   * Returns a detached view of every key assigned to an action.
   *
   * @param action - Player action whose browser key codes are requested.
   * @returns The action's key codes in display and evaluation order.
   */
  getBinding(action: BowAction): readonly string[] {
    return [...this.bindings[action]];
  }

  /**
   * Tests whether at least one held key drives an action.
   *
   * @param keys - Browser key codes currently held by the player.
   * @param action - Player action to evaluate.
   * @returns Whether one of the action's assigned keys is held.
   */
  isActionActive(keys: ReadonlySet<string>, action: BowAction): boolean {
    return this.bindings[action].some((code) => keys.has(code));
  }

  /**
   * Tests all four directional actions for local or network walk animation.
   *
   * @param keys - Browser key codes currently held by the player.
   * @returns Whether any directional movement action is active.
   */
  isAnyMovementActive(keys: ReadonlySet<string>): boolean {
    return (
      this.isActionActive(keys, 'moveForward') ||
      this.isActionActive(keys, 'moveBack') ||
      this.isActionActive(keys, 'moveLeft') ||
      this.isActionActive(keys, 'moveRight')
    );
  }

  /**
   * Tests whether a browser key code belongs to any player action.
   *
   * @param code - Browser physical-key code to test.
   * @returns Whether the code is assigned to at least one action.
   */
  isBoundCode(code: string): boolean {
    return BOW_ACTIONS.some((action) => this.bindings[action].includes(code));
  }

  /**
   * Replaces an action's bindings with one conflict-free key and saves immediately.
   *
   * Rebinding an action replaces all of that action's keys with the one key pressed. The key is
   * first removed from every other action, so one key never drives two actions. An action left
   * with no keys is unbound until it is rebound or defaults are restored.
   *
   * @param action - Player action that will receive the key.
   * @param code - Non-empty browser physical-key code pressed by the player.
   * @returns Nothing.
   * Persists the resulting bindings when the browser permits storage.
   */
  rebind(action: BowAction, code: string): void {
    if (!code) {
      return;
    }

    for (const otherAction of BOW_ACTIONS) {
      this.bindings[otherAction] = this.bindings[otherAction].filter(
        (boundCode) => boundCode !== code,
      );
    }

    this.bindings[action] = [code];
    this.persist();
  }

  /** Restores every key and mouse preference to its original value and saves immediately. */
  resetDefaults(): void {
    this.bindings = createDefaultBindings();
    this.isMouseYInverted = false;
    this.mouseSensitivityMultiplier = DEFAULT_MOUSE_SENSITIVITY_MULTIPLIER;
    this.persist();
  }

  /**
   * Returns whether vertical mouse input is inverted.
   *
   * @returns Whether vertical mouse look is inverted.
   */
  get invertMouseY(): boolean {
    return this.isMouseYInverted;
  }

  /**
   * Changes vertical mouse direction and saves the preference immediately.
   *
   * @param value - Whether vertical mouse look should be inverted.
   */
  set invertMouseY(value: boolean) {
    if (value === this.isMouseYInverted) {
      return;
    }

    this.isMouseYInverted = value;
    this.persist();
  }

  /**
   * Returns the multiplier applied equally to horizontal and vertical mouse look.
   *
   * @returns Current mouse sensitivity multiplier.
   */
  get mouseSensitivity(): number {
    return this.mouseSensitivityMultiplier;
  }

  /**
   * Changes mouse sensitivity within its supported range and saves immediately.
   *
   * @param value - Requested finite mouse sensitivity multiplier.
   */
  set mouseSensitivity(value: number) {
    if (!Number.isFinite(value)) {
      return;
    }

    const clampedValue = clampMouseSensitivity(value);

    if (clampedValue === this.mouseSensitivityMultiplier) {
      return;
    }

    this.mouseSensitivityMultiplier = clampedValue;
    this.persist();
  }

  private readStoredSettings(): void {
    try {
      if (typeof localStorage === 'undefined') {
        return;
      }

      const serialized = localStorage.getItem(BOW_SETTINGS_STORAGE_KEY);

      if (!serialized) {
        return;
      }

      const storedValue: unknown = JSON.parse(serialized);

      if (!isBowSettingsRecord(storedValue)) {
        console.warn('Stored bow settings were invalid; defaults will be used.', { storedValue });

        return;
      }

      this.bindings = readBindings(storedValue.bindings);

      for (const action of readUnboundActions(storedValue.unboundActions)) {
        this.bindings[action] = [];
      }

      removeBindingConflicts(this.bindings);

      if (typeof storedValue.invertMouseY === 'boolean') {
        this.isMouseYInverted = storedValue.invertMouseY;
      }

      if (
        typeof storedValue.mouseSensitivity === 'number' &&
        Number.isFinite(storedValue.mouseSensitivity)
      ) {
        this.mouseSensitivityMultiplier = clampMouseSensitivity(storedValue.mouseSensitivity);
      }
    } catch (error: unknown) {
      console.warn('Stored bow settings could not be read; defaults will be used.', { error });
    }
  }

  private persist(): void {
    const record = {
      bindings: this.bindings,
      invertMouseY: this.isMouseYInverted,
      mouseSensitivity: this.mouseSensitivityMultiplier,
      unboundActions: BOW_ACTIONS.filter((action) => this.bindings[action].length === 0),
    };

    try {
      localStorage.setItem(BOW_SETTINGS_STORAGE_KEY, JSON.stringify(record));
    } catch (error: unknown) {
      console.warn('Bow settings could not be saved.', { error });
    }
  }
}
