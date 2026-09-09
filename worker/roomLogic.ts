/**
 * Implements the deterministic room membership and round-scoring state machine.
 * It does not perform network I/O, persistence, validation, or logging.
 */

import { BOW_PROTOCOL_VERSION, BOW_ROOM_CAP, BOW_SCORE_LIMIT } from '../src/BowProtocol.js';

// Re-export centralized limits for existing Worker callers and focused tests.
export const ROOM_CAP = BOW_ROOM_CAP;
export const SCORE_LIMIT = BOW_SCORE_LIMIT;

/** A connected room member and the score attached to that live connection. */
export interface RoomPlayer {
  id: string;
  name: string;
  slot: number;
  kills: number;
}

/** The result of asking the room to count one death report. */
export interface DeathResult {
  accepted: boolean;
  scores: Record<string, number>;
  winnerId: string | null;
}

/** The public state returned after resetting a completed round. */
export interface RoundResetResult {
  round: number;
  scores: Record<string, number>;
}

/** Maintains stable player slots and first-to-limit scoring for one live room. */
export class RoomLogic {
  readonly players = new Map<string, RoomPlayer>();

  /**
   * Restores or initializes pure room state.
   *
   * @param round - Current one-based round number.
   * @param roundEnded - Whether the current round has already selected a winner.
   * @param players - Players reconstructed from live WebSocket attachments.
   */
  constructor(
    public round: number = BOW_PROTOCOL_VERSION,
    public roundEnded = false,
    players: RoomPlayer[] = [],
  ) {
    for (const player of players) {
      this.players.set(player.id, { ...player });
    }
  }

  /**
   * Adds a player to the lowest free slot or updates an existing player's name.
   *
   * @param id - Stable connection ID assigned by the Durable Object.
   * @param name - Sanitized display name.
   * @returns The joined player, or `null` when the room is full.
   */
  join(id: string, name: string): RoomPlayer | null {
    const existingPlayer = this.players.get(id);

    if (existingPlayer) {
      existingPlayer.name = name;

      return existingPlayer;
    }

    if (this.players.size >= ROOM_CAP) {
      return null;
    }

    const usedSlots = new Set([...this.players.values()].map((player) => player.slot));
    let slot = 0;

    while (usedSlots.has(slot)) {
      slot += 1;
    }

    const player = { id, name, slot, kills: 0 };
    this.players.set(id, player);

    return player;
  }

  /**
   * Removes one connected player.
   *
   * @param id - Player ID to remove.
   * @returns Whether the player existed before removal.
   */
  leave(id: string): boolean {
    return this.players.delete(id);
  }

  /**
   * Copies the current kill tally by player ID.
   *
   * @returns A detached score map.
   */
  scores(): Record<string, number> {
    return Object.fromEntries(
      [...this.players.values()].map((player) => [player.id, player.kills]),
    );
  }

  /**
   * Credits a reported death to a connected killer while the round is active.
   *
   * @param deadPlayerId - Reported victim ID; retained for the public room API.
   * @param killerId - Connected player ID to credit with one kill.
   * @returns Whether scoring changed, the new scores, and any winner ID.
   */
  death(deadPlayerId: string, killerId: string): DeathResult {
    // Victim validation is deliberately outside this trusted-friends scoring slice.
    void deadPlayerId;

    if (this.roundEnded) {
      return { accepted: false, scores: this.scores(), winnerId: null };
    }

    const killer = this.players.get(killerId);

    if (!killer) {
      return { accepted: false, scores: this.scores(), winnerId: null };
    }

    killer.kills += 1;
    const winnerId = killer.kills >= SCORE_LIMIT ? killer.id : null;

    if (winnerId) {
      this.roundEnded = true;
    }

    return { accepted: true, scores: this.scores(), winnerId };
  }

  /**
   * Starts the next round and clears every connected player's kills.
   *
   * @returns The new round number and cleared score map.
   */
  reset(): RoundResetResult {
    this.round += 1;
    this.roundEnded = false;

    for (const player of this.players.values()) {
      player.kills = 0;
    }

    return { round: this.round, scores: this.scores() };
  }
}
