/**
 * Defines and validates the version-one multiplayer wire protocol.
 * It does not open sockets, mutate room state, or apply gameplay effects.
 */
// Version one is the only protocol understood by this client and Worker.
export const BOW_PROTOCOL_VERSION = 1;
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
const PLAYER_ANIMATIONS = ['ready', 'walk', 'draw', 'release', 'dead'];
const SERVER_MESSAGE_TYPES = [
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
function isObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
// Narrows an unknown value to a finite number.
function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}
// Narrows an unknown value to a finite network vector.
function isNetworkVector(value) {
    return (isObject(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y) && isFiniteNumber(value.z));
}
// Narrows an unknown value to a bounded non-empty protocol identifier.
function isIdentifier(value) {
    return typeof value === 'string' && value.length > 0 && value.length <= MAX_IDENTIFIER_CHARACTERS;
}
// Narrows an unknown value to a supported remote animation name.
function isPlayerAnimation(value) {
    return typeof value === 'string' && PLAYER_ANIMATIONS.includes(value);
}
// Returns whether an ASCII character is safe to display in a player name.
function isDisplayCharacter(character) {
    const characterCode = character.charCodeAt(0);
    return characterCode >= FIRST_PRINTABLE_CHARACTER_CODE && characterCode !== DELETE_CHARACTER_CODE;
}
/**
 * Sanitizes a user-supplied display name for the in-game roster.
 *
 * @param value - Untrusted name value received from a client or text field.
 * @returns A trimmed, bounded display name, falling back to `Archer` when empty.
 */
export function cleanPlayerName(value) {
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
function parseClientState(raw) {
    if (!isFiniteNumber(raw.seq) ||
        !Number.isSafeInteger(raw.seq) ||
        raw.seq < 0 ||
        !isNetworkVector(raw.pos) ||
        !isFiniteNumber(raw.yaw) ||
        !isFiniteNumber(raw.pitch) ||
        !isFiniteNumber(raw.draw) ||
        raw.draw < 0 ||
        raw.draw > 1 ||
        !isPlayerAnimation(raw.anim)) {
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
function parseClientShot(raw) {
    if (!isIdentifier(raw.arrowId) ||
        !isNetworkVector(raw.origin) ||
        !isNetworkVector(raw.velocity)) {
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
function parseClientHit(raw) {
    if (!isIdentifier(raw.targetId) ||
        !isIdentifier(raw.arrowId) ||
        !isFiniteNumber(raw.damage) ||
        raw.damage <= 0 ||
        raw.damage > MAX_SHOT_DAMAGE ||
        typeof raw.head !== 'boolean') {
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
export function parseClientMessage(raw) {
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
export function parseServerMessage(raw) {
    if (!isObject(raw) || raw.v !== BOW_PROTOCOL_VERSION || typeof raw.type !== 'string') {
        return null;
    }
    const isKnownMessageType = SERVER_MESSAGE_TYPES.includes(raw.type);
    // The client and server ship from one bundle, so type/version recognition is the trust boundary.
    return isKnownMessageType ? raw : null;
}
