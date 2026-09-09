/**
 * Owns arena collision, batching, lighting, render settings, and their complete restoration.
 * It does not advance player, projectile, bot, combat, or network simulation.
 */
import {
  Color,
  DirectionalLight,
  FogExp2,
  Group,
  HemisphereLight,
  Material,
  Mesh,
  Object3D,
  Texture,
  Triangle,
  Vector3,
  type BufferGeometry,
  type ThreeViewer,
} from 'threepipe';
import { BowArrowTrails } from './BowArrowTrail.js';
import { buildBowArena } from './BowArena.js';
import { BowCollision } from './BowCollision.js';
import { batchBowScene } from './BowSceneBatch.js';
import { shotSpeed } from './BowPhysics.js';
import { BOW_ROOM_CAP } from './BowProtocol.js';
import type {
  BowGameConfig,
  CollisionTestAction,
  GameState,
  HiddenObjectState,
} from './GameState.js';

/** Callbacks and state needed by the explicit browser collision test hook. */
export interface CollisionInspectionOptions {
  state: GameState;
  action: CollisionTestAction;
  fixedStepSeconds: number;
  step: (dt: number) => void;
  fireArrow: (position: Vector3, velocity: Vector3, isVisualOnly: boolean) => void;
  getSlotSpawn: (slot: number) => Vector3;
}

interface SceneRestoreState {
  background: ThreeViewer['scene']['background'];
  fog: ThreeViewer['scene']['fog'];
  renderScale: number;
}

/** Arena ownership and scene integration settings for one runtime lifetime. */
export interface GameWorldOptions {
  arenaRoot?: Group;
  ownsArena: boolean;
}

/** Match settings needed to create the unchanged seeded runtime arena and configuration. */
export interface GameWorldBuildOptions {
  botCount: number;
  scoreLimit: number;
  difficulty: BowGameConfig['difficulty'];
}

/** Runtime arena and configuration created together from serialized component settings. */
export interface BuiltGameWorld {
  arenaRoot: Group;
  config: BowGameConfig;
}

/**
 * Builds the seeded arena and maps its authored spawns into one runtime configuration.
 *
 * @param options - Validated bot count, score limit, and difficulty from the host component.
 * @returns The owned arena root and matching mutable runtime configuration.
 */
export function buildGameWorld(options: GameWorldBuildOptions): BuiltGameWorld {
  const arena = buildBowArena();
  arena.group.name = 'K3D_BOW_RUNTIME_ARENA';
  const config: BowGameConfig = {
    version: 1,
    kind: 'bow-deathmatch',
    botCount: options.botCount,
    scoreLimit: options.scoreLimit,
    difficulty: options.difficulty,
    obstacles: arena.obstacles,
    botSpawns: arena.botSpawns.map(({ x, y, z }) => ({ x, y, z })),
    playerSpawn: {
      x: arena.playerSpawn.x,
      y: arena.playerSpawn.y,
      z: arena.playerSpawn.z,
    },
  };

  return { arenaRoot: arena.group, config };
}

/**
 * Removes one runtime group and disposes each unique geometry and material once.
 *
 * @param group - Runtime group whose descendants are no longer needed.
 */
export function disposeGroup(group: Group): void {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  group.traverse((object: Object3D) => {
    if (!(object instanceof Mesh)) {
      return;
    }

    geometries.add(object.geometry);
    const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
    objectMaterials.forEach((material) => materials.add(material));
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
  group.removeFromParent();
}

const disposeArena = (group: Group): void => {
  const textures = new Set<Texture>();
  group.traverse((object: Object3D) => {
    if (!(object instanceof Mesh)) {
      return;
    }

    const materials = Array.isArray(object.material) ? object.material : [object.material];

    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value instanceof Texture) {
          textures.add(value);
        }
      }
    }
  });
  disposeGroup(group);
  textures.forEach((texture) => texture.dispose());
};

/** Manages the static arena and scene resources shared by all gameplay systems. */
export class GameWorld {
  root = new Group();
  collision: BowCollision | null = null;
  trails: BowArrowTrails | null = null;
  sceneBatch: ReturnType<typeof batchBowScene> | null = null;

  private arenaRoot?: Group;
  private ownsArena: boolean;
  private hidden: HiddenObjectState[] = [];
  private sceneRestore: SceneRestoreState | null = null;

  /**
   * Creates an inert world owner for the viewer and serialized arena.
   *
   * @param viewer - Threepipe viewer whose scene receives runtime resources.
   * @param options - Arena root and teardown ownership settings.
   */
  constructor(
    private viewer: ThreeViewer,
    options: GameWorldOptions,
  ) {
    this.arenaRoot = options.arenaRoot;
    this.ownsArena = options.ownsArena;
  }

  /**
   * Returns the authored arena root used for collision and test inspection.
   *
   * @returns The arena group when supplied or discovered during startup.
   */
  getArenaRoot(): Group | undefined {
    return this.arenaRoot;
  }

  /**
   * Returns the collision-valid authored spawn for one stable online player slot.
   *
   * @param config - Authored player and bot spawn positions in world meters.
   * @param slot - Stable zero-based online player slot.
   * @returns A new collision-valid world position in meters.
   */
  getSlotSpawn(config: BowGameConfig, slot: number): Vector3 {
    if (slot === 0) {
      return new Vector3(config.playerSpawn.x, config.playerSpawn.y, config.playerSpawn.z);
    }

    const spawnCount = config.botSpawns.length;
    const base = config.botSpawns[(slot - 1) % spawnCount];
    const ring = Math.floor((slot - 1) / spawnCount);
    const wanted = new Vector3(
      base.x + (ring % 2 ? 5 : -5) * ring,
      base.y,
      base.z + (ring % 2 ? -4 : 4) * ring,
    );

    return this.collision?.spawn(wanted) ?? wanted;
  }

  /**
   * Creates collision, batching, trails, lighting, and play-mode render settings.
   *
   * @param config - Mutable match settings whose spawn points receive collision validation.
   */
  start(config: BowGameConfig): void {
    const scene = this.viewer.scene;
    this.sceneRestore = {
      background: scene.background,
      fog: scene.fog,
      renderScale: this.viewer.renderManager.renderScale,
    };
    this.viewer.renderManager.renderScale = Math.min(this.viewer.renderManager.renderScale, 1.1);
    scene.background = new Color(0xa5b3b4);
    scene.fog = new FogExp2(0xa5b3b4, 0.012);
    this.hideEditorObjects();
    this.root = new Group();
    this.root.name = 'K3D_BOW_RUNTIME';
    scene.add(this.root);
    this.prepareArena(config);
    this.trails = new BowArrowTrails();
    this.root.add(this.trails.root);
    this.addLighting();
  }

  private hideEditorObjects(): void {
    for (const object of this.viewer.scene.modelRoot.children) {
      if (object.name !== 'K3D_BOW_DEMO_ARENA') {
        this.hidden.push({ object, visible: object.visible });
        object.visible = false;
      }
    }
  }

  private prepareArena(config: BowGameConfig): void {
    const arena =
      this.arenaRoot ??
      this.viewer.scene.modelRoot.children.find((object) => object.name === 'K3D_BOW_DEMO_ARENA');

    if (!arena) {
      return;
    }

    this.arenaRoot = arena as Group;
    this.collision = new BowCollision(this.arenaRoot);
    const collision = this.collision;
    config.playerSpawn = collision.spawn(new Vector3().copy(config.playerSpawn));
    config.botSpawns = config.botSpawns.map((spawn) =>
      collision.spawn(new Vector3().copy(spawn), 0.42),
    );
    this.sceneBatch = batchBowScene(this.arenaRoot, this.root);
  }

  private addLighting(): void {
    const sky = new HemisphereLight(0xd9e6ee, 0x5b6040, 1.15);
    this.root.add(sky);
    const sun = new DirectionalLight(0xffdeb0, 3.3);
    sun.position.set(-16, 28, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, {
      left: -34,
      right: 34,
      top: 34,
      bottom: -34,
      near: 0.5,
      far: 95,
    });
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.04;
    this.root.add(sun);
    this.root.add(sun.target);
  }

  /** Disposes runtime resources and restores the exact pre-start scene settings. */
  stop(): void {
    this.collision?.dispose();
    this.collision = null;
    this.trails?.dispose();
    this.trails = null;
    this.sceneBatch?.dispose();
    this.sceneBatch = null;
    disposeGroup(this.root);
    this.hidden.forEach((hiddenObject) => {
      hiddenObject.object.visible = hiddenObject.visible;
    });
    this.hidden = [];

    if (this.sceneRestore) {
      this.viewer.scene.background = this.sceneRestore.background;
      this.viewer.scene.fog = this.sceneRestore.fog;
      this.viewer.renderManager.renderScale = this.sceneRestore.renderScale;
      this.sceneRestore = null;
      this.viewer.setDirty();
    }

    if (this.ownsArena && this.arenaRoot) {
      disposeArena(this.arenaRoot);
      this.arenaRoot = undefined;
    }
  }

  /**
   * Runs deterministic movement or shots and returns collision distances for browser tests.
   *
   * @param options - Test action, state, fixed-step, firing, and spawn callbacks.
   * @returns Serializable collision distances, player state, spawns, and BVH statistics.
   */
  inspectCollision(options: CollisionInspectionOptions): object {
    if (
      typeof location === 'undefined' ||
      !new URLSearchParams(location.search).has('collisionTest')
    ) {
      throw new Error('Collision test hook disabled');
    }

    const { state, action } = options;
    state.testClockPaused = true;

    if (action.position) {
      state.player.fromArray(action.position);
      state.velocity.set(0, 0, 0);
      state.grounded = false;
      state.coyoteSecondsRemaining = 0;
      state.lastWorldImpact = null;
      state.hp = 100;
    }

    if (action.yaw !== undefined) {
      state.yaw = action.yaw;
    }

    if (action.fire) {
      const fire = action.fire;
      options.fireArrow(
        new Vector3().fromArray(fire.origin),
        new Vector3().fromArray(fire.direction).normalize().multiplyScalar(shotSpeed(1)),
        Boolean(fire.remote),
      );
    }

    for (let i = 0; i < Math.min(1200, action.steps ?? 0); i++) {
      options.step(options.fixedStepSeconds);
    }

    if (action.resume) {
      state.testClockPaused = false;
    }

    return this.getCollisionInspection(state, options.getSlotSpawn);
  }

  private getCollisionInspection(
    state: GameState,
    getSlotSpawn: (slot: number) => Vector3,
  ): object {
    const impactPoint = state.lastWorldImpact;
    const rockDistance = this.getRockDistance(impactPoint);

    return {
      rockDistance: Number.isFinite(rockDistance) ? rockDistance : null,
      position: state.player.toArray(),
      grounded: state.grounded,
      penetration: this.collision?.penetration(state.player),
      lastImpact: impactPoint?.toArray() ?? null,
      impactDistance: impactPoint
        ? this.collision?.bvh.closestPointToPoint(impactPoint)?.distance
        : null,
      stats: this.collision?.stats(),
      spawns: Array.from({ length: BOW_ROOM_CAP }, (_unusedValue, i) => {
        const spawn = getSlotSpawn(i);

        return { position: spawn.toArray(), penetration: this.collision?.penetration(spawn) };
      }),
    };
  }

  private getRockDistance(impactPoint: Vector3 | null): number {
    let rockDistance = Infinity;

    if (!impactPoint || !this.arenaRoot) {
      return rockDistance;
    }

    const triangle = new Triangle();
    const closest = new Vector3();
    this.arenaRoot.traverse((object) => {
      const renderedMesh = object as Mesh;

      if (!renderedMesh.isMesh || renderedMesh.name !== 'Weathered granite') {
        return;
      }

      const positions = renderedMesh.geometry.getAttribute('position');
      const index = renderedMesh.geometry.index;

      for (let i = 0; i < (index?.count ?? positions.count); i += 3) {
        [triangle.a, triangle.b, triangle.c].forEach((vertex, j) => {
          const vertexIndex = index ? index.getX(i + j) : i + j;
          vertex.fromBufferAttribute(positions, vertexIndex).applyMatrix4(renderedMesh.matrixWorld);
        });
        triangle.closestPointToPoint(impactPoint, closest);
        rockDistance = Math.min(rockDistance, closest.distanceTo(impactPoint));
      }
    });

    return rockDistance;
  }
}
