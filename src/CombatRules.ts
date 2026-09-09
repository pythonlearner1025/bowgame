/**
 * Owns damage, deaths, respawn timers, scores, rounds, win conditions, and death-feed records.
 * It does not move actors, step projectiles, render avatars, or parse network messages.
 */
import { Vector3 } from 'threepipe';
import type { BowAudio } from './BowAudio.js';
import type { BotState, BowGameConfig, GameState } from './GameState.js';
import type { ServerMessage } from './BowProtocol.js';

// Death notices stay long enough to scan without becoming permanent HUD clutter.
const DEATH_FEED_DURATION_SECONDS = 8;

// Four recent events fit beneath the leaderboard at compact viewport heights.
const MAX_DEATH_FEED_ENTRIES = 4;

/** Side effects that combat rules delegate to their owning systems. */
export interface CombatRuleCallbacks {
  getAudio: () => BowAudio | null;
  getSlotSpawn: (slot: number) => Vector3;
  spawnBot: (bot: BotState, index: number) => void;
  clearArrows: () => void;
  resetRemotePlayers: () => void;
  sendDeath: (killerId: string) => void;
  updateCamera: () => void;
}

/** Applies the unchanged solo and online combat rules to shared simulation state. */
export class CombatRules {
  /**
   * Connects combat state to spawn, projectile, remote-player, audio, and network owners.
   *
   * @param state - Mutable simulation state shared by all systems.
   * @param getConfig - Returns required match settings and score limit.
   * @param isOnline - Returns whether this runtime has an online session.
   * @param callbacks - Side effects owned by other systems.
   */
  constructor(
    private state: GameState,
    private getConfig: () => BowGameConfig,
    private isOnline: () => boolean,
    private callbacks: CombatRuleCallbacks,
  ) {}

  /** Resets a full match while retaining allocated actor and world resources. */
  restart(): void {
    this.state.deathFeed = [];
    this.state.preview = null;

    if (!this.state.config) {
      return;
    }

    const local = this.state.networkSnapshot?.players.find((player) => player.local);
    this.state.player.copy(
      this.isOnline()
        ? this.callbacks.getSlotSpawn(local?.slot ?? 0)
        : this.state.config.playerSpawn,
    );
    this.state.hp = 100;
    this.state.kills = 0;
    this.state.deaths = 0;
    this.state.deadUntil = 0;
    this.state.winner = '';
    this.state.elapsed = 0;
    this.state.yaw = 0;
    this.state.pitch = 0;
    this.state.velocity.set(0, 0, 0);
    this.state.grounded = false;
    this.state.coyoteSecondsRemaining = 0;
    this.state.lastWorldImpact = null;
    this.state.drawing = false;
    this.state.charge = 0;
    this.state.cooldown = 0;
    this.state.releaseTime = -1;
    this.state.releasedCharge = 0;
    this.state.releaseFrom = null;
    this.state.cancelFrom = null;
    this.state.cancelTime = -1;
    this.state.aimBlend = 0;
    this.state.aiming = false;
    this.state.queuedDraw = false;
    this.state.flash = 0;
    this.state.hit = 0;
    this.state.message = '';
    this.state.messageUntil = 0;
    this.state.accumulator = 0;
    this.state.networkAccumulator = 0;
    this.state.networkSeq = 0;
    this.state.receivedHits.clear();
    this.callbacks.clearArrows();
    this.state.bots.forEach((bot, index) => {
      bot.kills = 0;
      bot.deaths = 0;
      this.callbacks.spawnBot(bot, index);
    });
    this.callbacks.updateCamera();
  }

  /** Respawns a dead local player once its unchanged three-second timer expires. */
  stepRespawn(): void {
    if (this.state.hp > 0 || this.state.elapsed < this.state.deadUntil) {
      return;
    }

    this.state.hp = 100;
    const local = this.state.networkSnapshot?.players.find((player) => player.local);
    this.state.player.copy(
      this.isOnline()
        ? this.callbacks.getSlotSpawn(local?.slot ?? 0)
        : this.getConfig().playerSpawn,
    );
    this.state.velocity.set(0, 0, 0);
    this.state.grounded = false;
    this.state.coyoteSecondsRemaining = 0;
    this.state.lastWorldImpact = null;
  }

  /**
   * Fades damage and hit-confirm feedback in fixed-step time.
   *
   * @param dt - Fixed simulation duration in seconds.
   */
  stepFeedback(dt: number): void {
    this.state.flash = Math.max(0, this.state.flash - dt * 1.8);
    this.state.hit = Math.max(0, this.state.hit - dt * 2.8);
  }

  /**
   * Applies one local solo hit and updates deaths, scores, messages, and the win condition.
   * @param victim - Negative one for the local player, or a solo bot index.
   * @param damage - Integer health points removed by the hit.
   * @param owner - Negative one for the local player, or a solo bot index.
   * @param isHead - Whether the swept arrow hit the head volume.
   */
  damage(victim: number, damage: number, owner: number, isHead: boolean): void {
    if (isHead && owner < 0 && victim >= 0) {
      this.callbacks.getAudio()?.headshotConfirm();
    }

    if (victim === -1) {
      this.damagePlayer(damage, owner);
    } else {
      this.damageBot(victim, damage, isHead);
    }

    if (this.state.kills >= this.getConfig().scoreLimit) {
      this.state.winner = 'YOU';
    }

    const winningBot = this.state.bots.find((bot) => bot.kills >= this.getConfig().scoreLimit);

    if (winningBot) {
      this.state.winner = winningBot.name;
    }
  }

  private damagePlayer(damage: number, owner: number): void {
    this.state.hp = Math.max(0, this.state.hp - damage);
    this.state.flash = 1;

    if (!this.state.hp) {
      this.state.deaths++;
      this.state.deadUntil = this.state.elapsed + 3;
      this.state.drawing = false;
      this.state.charge = 0;
      this.state.bots[owner].kills++;
      this.addDeath(this.state.bots[owner].name, 'YOU');
      this.state.message = `${this.state.bots[owner].name} eliminated you`;
      this.state.messageUntil = this.state.elapsed + 3;
    }
  }

  private damageBot(victim: number, damage: number, isHead: boolean): void {
    const bot = this.state.bots[victim];
    bot.hp = Math.max(0, bot.hp - damage);
    this.state.hit = 1;
    this.state.message = `${isHead ? 'HEADSHOT' : 'HIT'}  −${damage}  ${bot.name}`;
    this.state.messageUntil = this.state.elapsed + 1.7;

    if (!bot.hp) {
      bot.deaths++;
      bot.respawn = this.state.elapsed + 3.5;
      bot.mesh.visible = false;
      this.state.kills++;
      this.addDeath('YOU', bot.name);
      this.state.message = `${bot.name} eliminated  +1`;
    }
  }

  /**
   * Adds a newest-first death notice and preserves the four-entry cap.
   * @param killer - Display name shown on the left side of the notice.
   * @param victim - Display name shown on the right side of the notice.
   */
  addDeath(killer: string, victim: string): void {
    this.state.deathFeed.unshift({
      killer,
      victim,
      expiresAtSeconds: this.state.elapsed + DEATH_FEED_DURATION_SECONDS,
    });
    this.state.deathFeed.length = Math.min(this.state.deathFeed.length, MAX_DEATH_FEED_ENTRIES);
  }

  /**
   * Applies one deduplicated victim-authoritative hit received from the online session.
   * @param message - Parsed hit event addressed to the local online player.
   */
  applyNetworkHit(message: Extract<ServerMessage, { type: 'hit' }>): void {
    const key = `${message.playerId}:${message.arrowId}`;

    if (this.state.hp <= 0 || this.state.receivedHits.has(key)) {
      return;
    }

    this.state.receivedHits.add(key);
    this.state.hp = Math.max(0, this.state.hp - message.damage);
    this.state.flash = 1;
    this.callbacks
      .getAudio()
      ?.impact(
        this.state.player.clone().add(new Vector3(0, message.head ? 1.65 : 1.05, 0)),
        message.head ? 'head' : 'body',
      );

    if (this.state.hp > 0) {
      this.state.message = `${message.head ? 'HEADSHOT' : 'HIT'}  −${message.damage}`;
      this.state.messageUntil = this.state.elapsed + 1.7;

      return;
    }

    this.state.deaths++;
    this.state.deadUntil = this.state.elapsed + 3;
    this.state.drawing = false;
    this.state.charge = 0;
    this.callbacks.sendDeath(message.playerId);
    this.state.message = 'YOU WERE ELIMINATED';
    this.state.messageUntil = this.state.elapsed + 3;
  }

  /** Restores combatants, scores, projectiles, and feedback for a server-announced round reset. */
  resetOnlineRound(): void {
    this.state.deathFeed = [];
    this.state.hp = 100;
    this.state.deadUntil = 0;
    this.state.winner = '';
    this.state.receivedHits.clear();
    const local = this.state.networkSnapshot?.players.find((player) => player.local);
    this.state.player.copy(this.callbacks.getSlotSpawn(local?.slot ?? 0));
    this.state.velocity.set(0, 0, 0);
    this.state.grounded = false;
    this.state.coyoteSecondsRemaining = 0;
    this.state.lastWorldImpact = null;
    this.state.drawing = false;
    this.state.charge = 0;
    this.state.cooldown = 0;
    this.state.releaseTime = -1;
    this.state.message = 'NEW ROUND';
    this.state.messageUntil = this.state.elapsed + 2;
    this.callbacks.clearArrows();
    this.callbacks.resetRemotePlayers();
  }
}
