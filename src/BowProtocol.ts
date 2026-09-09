/**
 * Defines and validates the version-one multiplayer wire protocol.
 * It does not open sockets, mutate room state, or apply gameplay effects.
 */

// Version one is the only protocol understood by this client and Worker.
export const BOW_PROTOCOL_VERSION = 1 as const;

// Ten stable slots keep the arena readable and bound Worker fan-out.
export const BOW_ROOM_CAP = 10;

// Online rounds end at twenty eliminations.
export const BOW_SCORE_LIMIT = 20;

// Display names are intentionally short enough to fit the in-game roster.
const MAX_PLAYER_NAME_CHARACTERS = 24;

// Identifiers are bounded to prevent peers from relaying unreasonably large keys.
const MAX_IDENTIFIER_CHARACTERS = 80;

// The trusted-peer protocol still rejects damage larger than any legitimate shot.
const MAX_SHOT_DAMAGE = 200;

// ASCII control characters are removed because names are rendered in the HUD.
const FIRST_PRINTABLE_CHARACTER_CODE = 32;
const DELETE_CHARACTER_CODE = 127;

/** A JSON-safe three-dimensional vector measured in world meters. */
export interface NetVector3 {
  x: number;
  y: number;
  z: number;
}

/** The animation state relayed for a remote player. */
export type PlayerAnim = 'ready' | 'walk' | 'draw' | 'release' | 'dead';

/** A player's stable identity and visual slot within the current room. */
export interface RosterPlayer {
  id: string;
  name: string;
  slot: number;
}

/** Authoritative online-round kills indexed by player ID. */
export type ScoreMap = Record<string, number>;

/** Every valid version-one message accepted by the room from a client. */
export type ClientMessage =
  | { v: 1; type: 'join'; name: string }
  | {
      v: 1;
      type: 'state';
      seq: number;
      pos: NetVector3;
      yaw: number;
      pitch: number;
      draw: number;
      anim: PlayerAnim;
    }
  | { v: 1; type: 'shot'; arrowId: string; origin: NetVector3; velocity: NetVector3 }
  | { v: 1; type: 'hit'; targetId: string; arrowId: string; damage: number; head: boolean }
  | { v: 1; type: 'death'; killerId: string }
  | { v: 1; type: 'ping'; sentAt: number };

/** Every version-one message the room can send to a client. */
export type ServerMessage =
  | {
      v: 1;
      type: 'welcome';
      playerId: string;
      roster: RosterPlayer[];
      scores: ScoreMap;
      scoreLimit: number;
      round: number;
    }
  | { v: 1; type: 'join'; playerId: string; name: string; slot: number }
  | {
      v: 1;
      type: 'state';
      playerId: string;
      seq: number;
      pos: NetVector3;
      yaw: number;
      pitch: number;
      draw: number;
      anim: PlayerAnim;
    }
  | {
      v: 1;
      type: 'shot';
      playerId: string;
      arrowId: string;
      origin: NetVector3;
      velocity: NetVector3;
    }
  | {
      v: 1;
      type: 'hit';
      playerId: string;
      targetId: string;
      arrowId: string;
      damage: number;
      head: boolean;
    }
  | { v: 1; type: 'death'; playerId: string; killerId: string }
  | { v: 1; type: 'scores'; scores: ScoreMap }
  | { v: 1; type: 'round_end'; winnerId: string; scores: ScoreMap }
  | { v: 1; type: 'round_reset'; round: number }
  | { v: 1; type: 'leave'; playerId: string }
  | { v: 1; type: 'full' }
  | { v: 1; type: 'pong'; sentAt: number };

const PLAYER_ANIMATIONS: readonly PlayerAnim[] = ['ready', 'walk', 'draw', 'release', 'dead'];
const SERVER_MESSAGE_TYPES: readonly ServerMessage['type'][] = [
  'welcome',
  'join',
  'state',
  'shot',
  'hit',
  'death',
  'scores',
  'round_end',
  'round_reset',
  'leave',
  'full',
  'pong',
];

// Narrows an unknown value to an indexable, non-array object.
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Narrows an unknown value to a finite number.
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

// Narrows an unknown value to a finite network vector.
function isNetworkVector(value: unknown): value is NetVector3 {
  return (
    isObject(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y) && isFiniteNumber(value.z)
  );
}

// Narrows an unknown value to a bounded non-empty protocol identifier.
function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_IDENTIFIER_CHARACTERS;
}

// Narrows an unknown value to a supported remote animation name.
function isPlayerAnimation(value: unknown): value is PlayerAnim {
  return typeof value === 'string' && PLAYER_ANIMATIONS.includes(value as PlayerAnim);
}

// Returns whether an ASCII character is safe to display in a player name.
function isDisplayCharacter(character: string): boolean {
  const characterCode = character.charCodeAt(0);

  return characterCode >= FIRST_PRINTABLE_CHARACTER_CODE && characterCode !== DELETE_CHARACTER_CODE;
}

/**
 * Sanitizes a user-supplied display name for the in-game roster.
 *
 * @param value - Untrusted name value received from a client or text field.
 * @returns A trimmed, bounded display name, falling back to `Archer` when empty.
 */
export function cleanPlayerName(value: unknown): string {
  if (typeof value !== 'string') {
    return 'Archer';
  }

  const name = Array.from(value)
    .filter(isDisplayCharacter)
    .join('')
    .trim()
    .slice(0, MAX_PLAYER_NAME_CHARACTERS);

  return name || 'Archer';
}

// Parses a valid client state update without mutating the supplied object.
function parseClientState(raw: Record<string, unknown>): ClientMessage | null {
  if (
    !isFiniteNumber(raw.seq) ||
    !Number.isSafeInteger(raw.seq) ||
    raw.seq < 0 ||
    !isNetworkVector(raw.pos) ||
    !isFiniteNumber(raw.yaw) ||
    !isFiniteNumber(raw.pitch) ||
    !isFiniteNumber(raw.draw) ||
    raw.draw < 0 ||
    raw.draw > 1 ||
    !isPlayerAnimation(raw.anim)
  ) {
    return null;
  }

  return {
    v: BOW_PROTOCOL_VERSION,
    type: 'state',
    seq: raw.seq,
    pos: raw.pos,
    yaw: raw.yaw,
    pitch: raw.pitch,
    draw: raw.draw,
    anim: raw.anim,
  };
}

// Parses a valid client shot message without mutating the supplied object.
function parseClientShot(raw: Record<string, unknown>): ClientMessage | null {
  if (
    !isIdentifier(raw.arrowId) ||
    !isNetworkVector(raw.origin) ||
    !isNetworkVector(raw.velocity)
  ) {
    return null;
  }

  return {
    v: BOW_PROTOCOL_VERSION,
    type: 'shot',
    arrowId: raw.arrowId,
    origin: raw.origin,
    velocity: raw.velocity,
  };
}

// Parses a valid client hit message without mutating the supplied object.
function parseClientHit(raw: Record<string, unknown>): ClientMessage | null {
  if (
    !isIdentifier(raw.targetId) ||
    !isIdentifier(raw.arrowId) ||
    !isFiniteNumber(raw.damage) ||
    raw.damage <= 0 ||
    raw.damage > MAX_SHOT_DAMAGE ||
    typeof raw.head !== 'boolean'
  ) {
    return null;
  }

  return {
    v: BOW_PROTOCOL_VERSION,
    type: 'hit',
    targetId: raw.targetId,
    arrowId: raw.arrowId,
    damage: Math.round(raw.damage),
    head: raw.head,
  };
}

/**
 * Parses and validates an untrusted client protocol value.
 *
 * @param raw - Unknown value decoded from a WebSocket frame.
 * @returns A validated client message, or `null` for an unsupported or malformed value.
 */
export function parseClientMessage(raw: unknown): ClientMessage | null {
  if (!isObject(raw) || raw.v !== BOW_PROTOCOL_VERSION || typeof raw.type !== 'string') {
    return null;
  }

  switch (raw.type) {
    case 'join':
      return typeof raw.name === 'string'
        ? { v: BOW_PROTOCOL_VERSION, type: 'join', name: cleanPlayerName(raw.name) }
        : null;
    case 'state':
      return parseClientState(raw);
    case 'shot':
      return parseClientShot(raw);
    case 'hit':
      return parseClientHit(raw);
    case 'death':
      return isIdentifier(raw.killerId)
        ? { v: BOW_PROTOCOL_VERSION, type: 'death', killerId: raw.killerId }
        : null;
    case 'ping':
      return isFiniteNumber(raw.sentAt)
        ? { v: BOW_PROTOCOL_VERSION, type: 'ping', sentAt: raw.sentAt }
        : null;
    default:
      return null;
  }
}

/**
 * Accepts a versioned server message produced by the colocated trusted Worker bundle.
 *
 * @param raw - Unknown value decoded from a server WebSocket frame.
 * @returns A recognized server message, or `null` for an unknown version or message type.
 */
export function parseServerMessage(raw: unknown): ServerMessage | null {
  if (!isObject(raw) || raw.v !== BOW_PROTOCOL_VERSION || typeof raw.type !== 'string') {
    return null;
  }

  const isKnownMessageType = SERVER_MESSAGE_TYPES.includes(raw.type as ServerMessage['type']);

  // The client and server ship from one bundle, so type/version recognition is the trust boundary.
  return isKnownMessageType ? (raw as ServerMessage) : null;
}
