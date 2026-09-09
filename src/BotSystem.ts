/**
 * Owns solo bot creation, spawn recovery, movement AI, stuck handling, aiming, and rig poses.
 * It does not own player input, projectile collision, combat scoring, or online avatars.
 */
import { Vector3 } from 'threepipe';
import { createArrowModel } from './ArrowSystem.js';
import { attachHumanAsset } from './BowHumanAsset.js';
import { GRAVITY, moveWithCover, segmentCover, shotSpeed } from './BowPhysics.js';
import { bowNock, deformBow, makeFieldBow, makeHuman, poseArm, poseHuman } from './BowVisuals.js';
import { sampleBowPose } from './BowVisuals.js';
import type { BotPoseOptions, BotState, BowGameConfig, GameState } from './GameState.js';
import type { GameWorld } from './GameWorld.js';

/** Projectile launch side effect required by bot combat AI. */
export interface BotSystemCallbacks {
  fire: (position: Vector3, direction: Vector3, owner: number, charge: number) => void;
}

interface PoseArmsOptions {
  nock: Vector3;
  isRelaxed: boolean;
  release: number;
  draw: number;
}

interface MovementOptions {
  delta: Vector3;
  distance: number;
  isBlocked: boolean;
  dt: number;
}

interface AttackOptions {
  index: number;
  origin: Vector3;
  target: Vector3;
  distance: number;
  isBlocked: boolean;
  dt: number;
}

/** Advances every solo bot and keeps its reusable human rig posed. */
export class BotSystem {
  /**
   * Connects bot AI to shared state, arena collision, and arrow launching.
   *
   * @param state - Mutable simulation state shared by all systems.
   * @param world - Static collision and runtime scene resources.
   * @param getConfig - Returns required match tuning and spawn data.
   * @param callbacks - Projectile launch side effect.
   */
  constructor(
    private state: GameState,
    private world: GameWorld,
    private getConfig: () => BowGameConfig,
    private callbacks: BotSystemCallbacks,
  ) {}

  /**
   * Creates the configured solo population, or no bots for online play.
   *
   * @param isOnline - Whether remote players replace local bots.
   */
  start(isOnline: boolean): void {
    // Remote rigs replace bots online because independent local AI would diverge between peers.
    this.state.bots = isOnline
      ? []
      : Array.from({ length: this.getConfig().botCount }, (_unusedValue, i) => this.create(i));
  }

  /**
   * Creates one reusable bot rig with its authored name and initial timers.
   *
   * @param index - Stable zero-based solo bot index.
   * @returns A new bot state containing its rendered human, bow, and held arrow.
   */
  create(index: number): BotState {
    const human = makeHuman(index);
    attachHumanAsset(human, index);
    const botRoot = human.root;
    botRoot.name = ['ASH', 'ROOK', 'VALE', 'FLINT', 'MOSS', 'BEAR'][index];
    const bow = makeFieldBow();
    bow.scale.setScalar(1);
    bow.position.set(-0.22, 1.56, -0.6);
    botRoot.add(bow);
    const heldArrow = createArrowModel();
    heldArrow.scale.setScalar(1);
    botRoot.add(heldArrow);
    this.world.root.add(botRoot);

    return {
      mesh: botRoot,
      name: botRoot.name,
      hp: 100,
      kills: 0,
      deaths: 0,
      cooldown: 2 + index,
      respawn: 0,
      phase: index * 2.1,
      draw: 0,
      leftLeg: human.legs[0].root,
      rightLeg: human.legs[1].root,
      bow,
      human,
      release: -1,
      heldArrow,
    };
  }

  /**
   * Restores one bot at its validated spawn while retaining its match score.
   *
   * @param bot - Bot state to respawn.
   * @param index - Stable zero-based solo bot index.
   */
  spawn(bot: BotState, index: number): void {
    const config = this.getConfig();
    const spawn = config.botSpawns[index % config.botSpawns.length];
    bot.mesh.position.set(spawn.x + (index >= 3 ? 3 : 0), spawn.y, spawn.z);

    if (bot.mesh.position.distanceTo(this.state.player) < 8) {
      bot.mesh.position.set(-bot.mesh.position.x, bot.mesh.position.y, -bot.mesh.position.z);
    }

    if (this.world.collision) {
      bot.mesh.position.copy(this.world.collision.spawn(bot.mesh.position, 0.42));
    }

    bot.velocity = new Vector3();
    bot.stuckTime = 0;
    bot.stuckAnchor = bot.mesh.position.clone();
    bot.escapeTarget = undefined;
    bot.hp = 100;
    bot.mesh.visible = true;
    bot.cooldown = 2 + index * 0.35;
    bot.draw = 0;
    bot.release = -1;
    bot.respawn = 0;
    this.updatePose(bot, { draw: 0 });
  }

  /** Resets bot scores and restores every bot at its indexed spawn. */
  reset(): void {
    this.state.bots.forEach((bot, index) => {
      bot.kills = 0;
      bot.deaths = 0;
      this.spawn(bot, index);
    });
  }

  /**
   * Advances all bot AI once in stable array order.
   *
   * @param dt - Fixed simulation duration in seconds.
   */
  step(dt: number): void {
    this.state.bots.forEach((bot, index) => this.stepBot(bot, index, dt));
  }

  /**
   * Applies current walk, draw, release, and relaxed values to one human rig.
   *
   * @param bot - Bot or remote-player rig to pose.
   * @param options - Current normalized draw, walk, release, and relaxed values.
   */
  updatePose(bot: BotState, options: BotPoseOptions): void {
    const walk = options.walk ?? 0;
    const isRelaxed = options.isRelaxed ?? false;
    const release = options.release ?? -1;
    const pose = sampleBowPose(options.draw, release, 1, this.state.elapsed);
    poseHuman(bot.human, pose.draw, walk, isRelaxed);
    bot.bow.visible = !isRelaxed;
    bot.heldArrow.visible = !isRelaxed;
    bot.bow.position.set(-0.22, 1.56, -0.6);
    bot.bow.rotation.set(-0.1, 0.58, 0);

    if (release >= 0.15 && release < 1.05) {
      const progress = (release - 0.15) / 0.9;
      const reach = Math.sin(progress * Math.PI);
      bot.bow.position.y -= reach * 0.13;
      bot.bow.rotation.z = -reach * 0.22;
      poseArm(
        bot.human.right,
        new Vector3(0.245, 1.44, 0),
        new Vector3(0.45, 1.5 + reach * 0.15, 0.05),
        new Vector3(0.13, 1.4 + reach * 0.48, -0.1 + reach * 0.24),
      );
    }

    deformBow(bot.bow, pose.draw, pose.vibration);
    bot.heldArrow.visible = !isRelaxed && pose.arrowVisible;
    const nock = bowNock(pose.draw).applyQuaternion(bot.bow.quaternion).add(bot.bow.position);
    this.poseArms(bot, { nock, isRelaxed, release, draw: pose.draw });
    bot.heldArrow.position
      .copy(nock)
      .add(new Vector3(0, 0, -0.28).applyQuaternion(bot.bow.quaternion));
    bot.heldArrow.quaternion.copy(bot.bow.quaternion);
    bot.human.applyPose?.(isRelaxed);
  }

  private poseArms(bot: BotState, options: PoseArmsOptions): void {
    if (options.isRelaxed) {
      return;
    }

    poseArm(
      bot.human.left,
      new Vector3(-0.245, 1.44, 0),
      new Vector3(-0.29, 1.46, -0.31),
      bot.bow.position,
      bot.bow.quaternion,
    );

    if (options.release < 0.15 || options.release >= 1.05) {
      poseArm(
        bot.human.right,
        new Vector3(0.245, 1.44, 0),
        new Vector3(
          0.4 + options.draw * 0.12,
          1.38 + options.draw * 0.08,
          -0.12 + options.draw * 0.2,
        ),
        options.nock,
        bot.bow.quaternion,
      );
    }
  }

  /** Applies current simulation values to every living bot after fixed stepping. */
  updatePoses(): void {
    for (const bot of this.state.bots) {
      if (bot.hp > 0) {
        this.updatePose(bot, { draw: bot.draw, walk: bot.walk, release: bot.release });
      }
    }
  }

  private stepBot(bot: BotState, index: number, dt: number): void {
    if (bot.hp <= 0) {
      if (this.state.elapsed > bot.respawn) {
        this.spawn(bot, index);
      }

      return;
    }

    const target = this.state.player.clone().add(new Vector3(0, 1.28, 0));
    const origin = bot.mesh.position.clone().add(new Vector3(0, 1.34, 0));
    const delta = target.clone().sub(origin);
    const distance = delta.length();
    bot.mesh.rotation.y = Math.atan2(-delta.x, -delta.z);
    bot.cooldown -= dt;
    this.stepRelease(bot, dt);
    const blocked = this.isBlocked(origin, target);
    const movement = this.getMovement(bot, { delta, distance, isBlocked: blocked, dt });
    const old = bot.mesh.position.clone();
    this.move(bot, old, movement, dt);
    const isWalking = old.distanceTo(bot.mesh.position) > dt * 0.2;
    bot.leftLeg.rotation.x = isWalking ? Math.sin(this.state.elapsed * 7 + bot.phase) * 0.5 : 0;
    bot.rightLeg.rotation.x = -bot.leftLeg.rotation.x;
    this.stepAttack(bot, { index, origin, target, distance, isBlocked: blocked, dt });
    bot.walk = isWalking ? Math.sin(this.state.elapsed * 7 + bot.phase) : 0;
  }

  private stepRelease(bot: BotState, dt: number): void {
    if (bot.release >= 0) {
      bot.release += dt;

      if (bot.release >= 1.05) {
        bot.release = -1;
      }
    }
  }

  private isBlocked(origin: Vector3, target: Vector3): boolean {
    if (this.world.collision) {
      return this.world.collision.segment(origin, target) !== null;
    }

    return this.getConfig().obstacles.some((cover) => segmentCover(origin, target, cover) !== null);
  }

  private getMovement(bot: BotState, options: MovementOptions): Vector3 {
    let advance = 0.05;

    if (options.distance > 17) {
      advance = 1;
    } else if (options.distance < 9) {
      advance = -0.8;
    }

    const toward = options.delta.clone().setY(0).normalize();
    const side = new Vector3(-toward.z, 0, toward.x);

    return toward
      .multiplyScalar(options.isBlocked ? 1 : advance)
      .addScaledVector(side, options.isBlocked ? 1 : 0.7)
      .normalize()
      .multiplyScalar((bot.draw ? 1.2 : 2.1) * options.dt);
  }

  private move(bot: BotState, old: Vector3, movement: Vector3, dt: number): void {
    if (!this.world.collision) {
      bot.mesh.position.copy(
        moveWithCover(old, movement.x, movement.z, this.getConfig().obstacles, 0.42),
      );

      return;
    }

    this.applyEscapeMovement(bot, old, movement, dt);
    bot.velocity ??= new Vector3();
    bot.velocity.x = movement.x / dt;
    bot.velocity.z = movement.z / dt;
    bot.velocity.y -= GRAVITY * dt;
    this.world.collision.move(bot.mesh.position, bot.velocity, dt, 0.42);
    this.updateStuckState(bot, old, dt);
  }

  private applyEscapeMovement(bot: BotState, old: Vector3, movement: Vector3, dt: number): void {
    if (!bot.escapeTarget) {
      return;
    }

    movement
      .copy(bot.escapeTarget)
      .sub(old)
      .setY(0)
      .normalize()
      .multiplyScalar((bot.draw ? 1.2 : 2.1) * dt);

    if (old.distanceTo(bot.escapeTarget) < 0.6) {
      bot.escapeTarget = undefined;
    }
  }

  private updateStuckState(bot: BotState, old: Vector3, dt: number): void {
    bot.stuckAnchor ??= old.clone();
    bot.stuckTime = (bot.stuckTime ?? 0) + dt;

    if (bot.stuckTime < 1.5) {
      return;
    }

    if (bot.mesh.position.distanceTo(bot.stuckAnchor) < 0.2) {
      const angle = Math.random() * Math.PI * 2;
      bot.escapeTarget = old.clone().add(new Vector3(Math.cos(angle) * 4, 0, Math.sin(angle) * 4));
    }

    bot.stuckAnchor.copy(bot.mesh.position);
    bot.stuckTime = 0;
  }

  private stepAttack(bot: BotState, options: AttackOptions): void {
    if (this.state.hp <= 0 || options.isBlocked || options.distance >= 38 || bot.cooldown > 0) {
      bot.draw = Math.max(0, bot.draw - options.dt * 2);

      return;
    }

    bot.draw += options.dt / 1.1;

    if (bot.draw < 1) {
      return;
    }

    const tuning = this.getAttackTuning();
    const speed = shotSpeed(0.85);
    options.target.y += GRAVITY * 0.5 * Math.pow(options.distance / speed, 2);
    options.target.x += (Math.random() - 0.5) * options.distance * tuning.spread;
    options.target.y += (Math.random() - 0.5) * options.distance * tuning.spread;
    this.callbacks.fire(
      options.origin,
      options.target.sub(options.origin).normalize(),
      options.index,
      0.85,
    );
    bot.draw = 0;
    bot.release = 0;
    bot.cooldown = tuning.cooldown + Math.random();
  }

  private getAttackTuning(): { spread: number; cooldown: number } {
    const level = this.getConfig().difficulty;

    if (level === 'easy') {
      return { spread: 0.1, cooldown: 3.4 };
    }

    if (level === 'hard') {
      return { spread: 0.017, cooldown: 1.7 };
    }

    return { spread: 0.045, cooldown: 2.6 };
  }
}
