/**
 * Owns arrow models, ballistic stepping, swept impacts, hit volumes, and pooled trails.
 * It does not decide score, death, respawn, or network protocol behavior.
 */
import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  Group,
  Material,
  Mesh,
  MeshStandardMaterial,
  Vector3,
} from 'threepipe';
import { BowArrowTrails } from './BowArrowTrail.js';
import type { BowAudio } from './BowAudio.js';
import { GRAVITY, segmentCover, segmentSphere, shotDamage, shotSpeed } from './BowPhysics.js';
import type { ArrowState, BowGameConfig, GameState } from './GameState.js';
import { disposeGroup, type GameWorld } from './GameWorld.js';

/** A living player volume that can be swept by an arrow segment. */
export interface ArrowCandidate {
  position: Vector3;
  hp: number;
  index: number | string;
}

/** Settings that distinguish local, bot, and visual-only remote arrows. */
export interface SpawnArrowOptions {
  owner: number;
  arrowId?: string;
  isVisualOnly?: boolean;
  damage?: number;
  sourcePlayerId?: string;
}

/** Side effects delegated to combat, remote-player, audio, and network owners. */
export interface ArrowSystemCallbacks {
  getAudio: () => BowAudio | null;
  isOnline: () => boolean;
  getRemoteCandidates: (excludedPlayerId?: string) => ArrowCandidate[];
  applyDamage: (victim: number, damage: number, owner: number, isHead: boolean) => void;
  sendShot: (arrowId: string, position: Vector3, velocity: Vector3) => void;
  sendHit: (targetId: string, arrowId: string, damage: number, isHead: boolean) => void;
}

interface ArrowIntersection {
  nearest: number;
  victim: number | string | null;
  isHead: boolean;
  hasCollided: boolean;
}

const MAT = (color: number, metalness = 0): MeshStandardMaterial =>
  new MeshStandardMaterial({ color, roughness: 0.85, metalness });

const mesh = (
  geometry: BufferGeometry,
  material: Material,
  parent: Group,
  options: { x?: number; y?: number; z?: number } = {},
): Mesh => {
  const renderedMesh = new Mesh(geometry, material);
  renderedMesh.position.set(options.x ?? 0, options.y ?? 0, options.z ?? 0);
  renderedMesh.castShadow = true;
  renderedMesh.receiveShadow = true;
  parent.add(renderedMesh);

  return renderedMesh;
};

const stick = (
  parent: Group,
  start: Vector3,
  end: Vector3,
  options: { radius: number; material: Material },
): Mesh => {
  const renderedMesh = mesh(
    new CylinderGeometry(options.radius, options.radius, start.distanceTo(end), 8),
    options.material,
    parent,
  );
  renderedMesh.position.copy(start).add(end).multiplyScalar(0.5);
  renderedMesh.quaternion.setFromUnitVectors(
    new Vector3(0, 1, 0),
    end.clone().sub(start).normalize(),
  );

  return renderedMesh;
};

/**
 * Creates the shared physical arrow model used by every archer and projectile.
 *
 * @returns A new disposable arrow group aligned along local negative Z.
 */
export function createArrowModel(): Group {
  const arrow = new Group();
  const wood = MAT(0xaa772d);
  const iron = MAT(0xc3c6be, 0.25);
  const feather = MAT(0x6d5732);
  stick(arrow, new Vector3(0, 0, 0.28), new Vector3(0, 0, -0.71), {
    radius: 0.0035,
    material: wood,
  });
  const tip = mesh(new CylinderGeometry(0, 0.006, 0.06, 4), iron, arrow, { z: -0.735 });
  tip.rotation.x = -Math.PI / 2;

  for (let i = 0; i < 3; i++) {
    const featherMesh = mesh(new BoxGeometry(0.042, 0.003, 0.15), feather, arrow, { z: 0.2 });
    featherMesh.rotation.z = (i * Math.PI * 2) / 3;
  }

  return arrow;
}

/** Advances all projectiles and delegates resulting damage or network messages. */
export class ArrowSystem {
  /**
   * Connects projectile simulation to shared state and side-effect owners.
   *
   * @param state - Mutable simulation state shared by all systems.
   * @param world - Static collision, runtime root, and trail resources.
   * @param getConfig - Returns the required serialized match settings.
   * @param callbacks - Combat, remote-player, audio, and network side effects.
   */
  constructor(
    private state: GameState,
    private world: GameWorld,
    private getConfig: () => BowGameConfig,
    private callbacks: ArrowSystemCallbacks,
  ) {}

  /**
   * Launches an arrow and sends local online shots through the network owner.
   *
   * @param position - Arrowhead origin in world meters.
   * @param direction - Mutable normalized world direction multiplied by launch speed.
   * @param owner - Negative one for the local player, or a solo bot index.
   * @param charge - Normalized bow charge from zero to one.
   */
  fire(position: Vector3, direction: Vector3, owner: number, charge: number): void {
    const velocity = direction.multiplyScalar(shotSpeed(charge));
    const arrowId =
      this.callbacks.isOnline() && owner < 0
        ? `${this.state.networkSnapshot.playerId ?? 'pending'}-${++this.state.arrowSeq}`
        : undefined;
    this.spawn(position, velocity, {
      owner,
      arrowId,
      isVisualOnly: false,
      damage: shotDamage(charge),
    });

    if (arrowId) {
      this.callbacks.sendShot(arrowId, position, velocity);
    }
  }

  /**
   * Adds one supplied projectile to the world without changing its origin or velocity.
   *
   * @param position - Mutable arrowhead position in world meters.
   * @param velocity - Mutable arrow velocity in meters per second.
   * @param options - Ownership, damage, protocol identity, and visual-only settings.
   */
  spawn(position: Vector3, velocity: Vector3, options: SpawnArrowOptions): void {
    const damage = options.damage ?? shotDamage(1);
    const isVisualOnly = options.isVisualOnly ?? false;
    const owner = options.owner;
    this.callbacks.getAudio()?.release(owner < 0 ? undefined : position, owner);
    const model = createArrowModel();
    model.position.copy(position);
    this.world.root.add(model);

    if (!this.world.trails) {
      this.world.trails = new BowArrowTrails();
      this.world.root.add(this.world.trails.root);
    }

    const trail = this.world.trails.spawn(position, this.state.elapsed);
    this.state.arrows.push({
      mesh: model,
      position,
      velocity,
      owner,
      damage,
      age: 0,
      stuck: false,
      trail,
      arrowId: options.arrowId,
      visualOnly: isVisualOnly,
      sourcePlayerId: options.sourcePlayerId,
    });

    if (this.state.arrows.length > 90) {
      const oldestArrow = this.state.arrows.shift();

      if (oldestArrow) {
        this.world.trails.remove(oldestArrow.trail);
        disposeGroup(oldestArrow.mesh);
      }
    }
  }

  private getCandidates(arrow: ArrowState): ArrowCandidate[] {
    if (arrow.visualOnly) {
      return [
        { position: this.state.player, hp: this.state.hp, index: -1 },
        ...this.callbacks.getRemoteCandidates(arrow.sourcePlayerId),
      ];
    }

    if (this.callbacks.isOnline() && arrow.owner < 0) {
      return this.callbacks.getRemoteCandidates();
    }

    if (arrow.owner < 0) {
      return this.state.bots.map((bot, i) => ({
        position: bot.mesh.position,
        hp: bot.hp,
        index: i,
      }));
    }

    return [{ position: this.state.player, hp: this.state.hp, index: -1 }];
  }

  private findIntersection(from: Vector3, to: Vector3, arrow: ArrowState): ArrowIntersection {
    const intersection: ArrowIntersection = {
      nearest: 1,
      victim: null,
      isHead: false,
      hasCollided: false,
    };

    if (this.world.collision) {
      const hit = this.world.collision.segment(from, to);

      if (hit) {
        intersection.nearest = hit.t;
        intersection.hasCollided = true;
      }
    } else {
      this.findLegacyWorldIntersection(from, to, intersection);
    }

    for (const candidate of this.getCandidates(arrow)) {
      this.testCandidate(from, to, candidate, intersection);
    }

    return intersection;
  }

  private findLegacyWorldIntersection(
    from: Vector3,
    to: Vector3,
    intersection: ArrowIntersection,
  ): void {
    if (to.y <= 0.025) {
      intersection.nearest = Math.max(0, (from.y - 0.025) / (from.y - to.y));
      intersection.hasCollided = true;
    }

    for (const cover of this.getConfig().obstacles) {
      const coverTime = segmentCover(from, to, cover);

      if (coverTime !== null && coverTime <= intersection.nearest) {
        intersection.nearest = coverTime;
        intersection.victim = null;
        intersection.hasCollided = true;
      }
    }
  }

  private testCandidate(
    from: Vector3,
    to: Vector3,
    candidate: ArrowCandidate,
    intersection: ArrowIntersection,
  ): void {
    if (candidate.hp <= 0) {
      return;
    }

    for (const [height, radius, isHead] of [
      [1.65, 0.24, true],
      [1.05, 0.4, false],
      [0.5, 0.29, false],
    ] as const) {
      const hitTime = segmentSphere(
        from,
        to,
        candidate.position.clone().add(new Vector3(0, height, 0)),
        radius,
      );

      if (hitTime !== null && hitTime < intersection.nearest) {
        intersection.nearest = hitTime;
        intersection.victim = candidate.index;
        intersection.isHead = isHead;
        intersection.hasCollided = true;
      }
    }
  }

  private handleCollision(arrow: ArrowState, intersection: ArrowIntersection): void {
    const { victim, isHead } = intersection;

    if (victim === null) {
      this.state.lastWorldImpact = arrow.position.clone();
    }

    let impactKind: 'head' | 'body' | 'cover' = 'cover';

    if (isHead) {
      impactKind = 'head';
    } else if (victim !== null) {
      impactKind = 'body';
    }

    this.callbacks.getAudio()?.impact(arrow.position, impactKind);
    this.world.trails?.stop(arrow.trail);
    arrow.stuck = true;
    arrow.age = 8;

    if (victim === null) {
      return;
    }

    if (arrow.visualOnly) {
      arrow.mesh.visible = false;

      return;
    }

    const damage = Math.round(arrow.damage * (isHead ? 1.8 : 1));

    if (typeof victim === 'string') {
      this.handleRemoteHit(arrow, victim, damage, isHead);
    } else {
      this.callbacks.applyDamage(victim, damage, arrow.owner, isHead);
    }

    arrow.mesh.visible = false;
  }

  private handleRemoteHit(
    arrow: ArrowState,
    victim: string,
    damage: number,
    isHead: boolean,
  ): void {
    if (isHead) {
      this.callbacks.getAudio()?.headshotConfirm();
    }

    this.state.hit = 1;
    const remote = this.state.remotePlayers.get(victim);
    this.state.message = `${isHead ? 'HEADSHOT' : 'HIT'}  −${damage}  ${remote?.name ?? 'ARCHER'}`;
    this.state.messageUntil = this.state.elapsed + 1.7;

    if (arrow.arrowId) {
      this.callbacks.sendHit(victim, arrow.arrowId, damage, isHead);
    }
  }

  /**
   * Advances every arrow by one fixed simulation step.
   *
   * @param dt - Fixed simulation duration in seconds.
   */
  step(dt: number): void {
    for (const arrow of [...this.state.arrows]) {
      arrow.age += dt;

      if (arrow.age > 12) {
        this.remove(arrow);
        continue;
      }

      if (arrow.stuck) {
        continue;
      }

      this.stepArrow(arrow, dt);

      if (arrow.position.length() > 110) {
        this.remove(arrow);
      }
    }
  }

  private stepArrow(arrow: ArrowState, dt: number): void {
    const from = arrow.position.clone();
    arrow.velocity.y -= GRAVITY * dt;
    const to = from.clone().addScaledVector(arrow.velocity, dt);
    const intersection = this.findIntersection(from, to, arrow);
    arrow.position.copy(from).lerp(to, intersection.nearest);
    this.world.trails?.sample(arrow.trail, arrow.position, this.state.elapsed);
    arrow.mesh.position
      .copy(arrow.position)
      .addScaledVector(arrow.velocity.clone().normalize(), -0.765);
    arrow.mesh.quaternion.setFromUnitVectors(
      new Vector3(0, 0, -1),
      arrow.velocity.clone().normalize(),
    );

    if (
      !intersection.hasCollided &&
      arrow.owner >= 0 &&
      !arrow.whizzed &&
      this.callbacks.getAudio()?.whizz(from, to)
    ) {
      arrow.whizzed = true;
    }

    if (intersection.hasCollided) {
      this.handleCollision(arrow, intersection);
    }
  }

  private remove(arrow: ArrowState): void {
    this.world.trails?.remove(arrow.trail);
    disposeGroup(arrow.mesh);
    this.state.arrows.splice(this.state.arrows.indexOf(arrow), 1);
  }

  /** Removes every arrow and clears all pooled trail slots. */
  clear(): void {
    this.state.arrows.forEach((arrow) => disposeGroup(arrow.mesh));
    this.state.arrows = [];
    this.world.trails?.clear();
  }
}
