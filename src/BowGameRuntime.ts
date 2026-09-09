/**
 * Coordinates bow-deathmatch gameplay while delegating rendering, collision, audio, and networking.
 * World coordinates use meters, Y is up, rotations use radians, and delta times use seconds.
 */
import {
  Triangle,
  Group,
  Mesh,
  CylinderGeometry,
  BoxGeometry,
  MeshStandardMaterial,
  Vector3,
  Quaternion,
  Color,
  FogExp2,
  HemisphereLight,
  DirectionalLight,
  BufferGeometry,
  Line,
  Material,
  Texture,
  Object3D,
  type ThreeViewer,
} from 'threepipe';
import {
  makeFieldBow,
  deformBow,
  bowNock,
  makeHuman,
  poseHuman,
  makeArm,
  poseArm,
  sampleBowPose,
  firstPersonSkin,
  type HumanRig,
  type ArmRig,
} from './BowVisuals.js';
import { preloadHumanAsset, attachHumanAsset } from './BowHumanAsset.js';
import { attachFirstPersonArm } from './BowHandRig.js';
import {
  sampleReferenceAction,
  sampleReferenceTimeline,
  referenceScreenPoint,
  referenceRotation,
  referenceArrow,
  blendReferencePoses,
  BOW_RELEASE_SECONDS,
  type ReferencePose,
} from './BowReferenceClip.js';
import { BowArrowTrails, type ArrowTrailHandle } from './BowArrowTrail.js';
import type { BowPerformance } from './BowPerformance.js';
import { BowCollision } from './BowCollision.js';
import { batchBowScene } from './BowSceneBatch.js';
import { BowAudio } from './BowAudio.js';
import {
  BOW_DRAW_SECONDS,
  GRAVITY,
  shotSpeed,
  shotDamage,
  segmentSphere,
  segmentCover,
  moveWithCover,
  type Cover,
} from './BowPhysics.js';
import { BowNetSession, type NetSnapshot } from './BowNetSession.js';
import { BOW_ROOM_CAP, type PlayerAnim, type ServerMessage } from './BowProtocol.js';

export interface BowGameConfig {
  version: 1;
  kind: 'bow-deathmatch';
  botCount: number;
  scoreLimit: number;
  difficulty: 'easy' | 'normal' | 'hard';
  obstacles: Cover[];
  botSpawns: { x: number; y: number; z: number }[];
  playerSpawn: { x: number; y: number; z: number };
}

/** Optional dependencies and lifecycle ownership supplied by the hosting component. */
export interface BowGameRuntimeOptions {
  config?: BowGameConfig;
  arenaRoot?: Group;
  isPaused?: () => boolean;
  ownsArena?: boolean;
  session?: BowNetSession | null;
  performanceStats?: BowPerformance | null;
}

interface CameraRestoreState {
  position: Vector3;
  quaternion: Quaternion;
  target?: Vector3;
  fov?: number;
  controls?: boolean;
}

interface SceneRestoreState {
  background: ThreeViewer['scene']['background'];
  fog: ThreeViewer['scene']['fog'];
  renderScale: number;
}

interface InspectOptions {
  view?: 'first-person' | 'character';
  draw?: number;
  release?: number;
  orbit?: number;
  referenceTime?: number;
  aim?: boolean;
  flightSeconds?: number;
  flightSide?: boolean;
  resume?: boolean;
}

interface CollisionTestAction {
  resume?: boolean;
  position?: [number, number, number];
  yaw?: number;
  steps?: number;
  fire?: {
    origin: [number, number, number];
    direction: [number, number, number];
    remote?: boolean;
  };
}

interface BotPoseOptions {
  draw: number;
  walk?: number;
  isRelaxed?: boolean;
  release?: number;
}

interface SpawnArrowOptions {
  owner: number;
  arrowId?: string;
  isVisualOnly?: boolean;
  damage?: number;
  sourcePlayerId?: string;
}

interface ArrowCandidate {
  position: Vector3;
  hp: number;
  index: number | string;
}

interface ArrowIntersection {
  nearest: number;
  victim: number | string | null;
  isHead: boolean;
  hasCollided: boolean;
}
interface Bot {
  mesh: Group;
  name: string;
  hp: number;
  kills: number;
  deaths: number;
  cooldown: number;
  respawn: number;
  phase: number;
  draw: number;
  leftLeg: Group;
  rightLeg: Group;
  bow: Group;
  human: HumanRig;
  release: number;
  heldArrow: Group;
  walk?: number;
  velocity?: Vector3;
  stuckTime?: number;
  stuckAnchor?: Vector3;
  escapeTarget?: Vector3;
}
interface RemotePlayer extends Bot {
  id: string;
  slot: number;
  seq: number;
  target: Vector3;
  targetYaw: number;
  targetPitch: number;
  targetDraw: number;
  anim: PlayerAnim;
}
interface Arrow {
  mesh: Group;
  position: Vector3;
  velocity: Vector3;
  owner: number;
  damage: number;
  age: number;
  stuck: boolean;
  trail: ArrowTrailHandle;
  arrowId?: string;
  visualOnly?: boolean;
  sourcePlayerId?: string;
  whizzed?: boolean;
}
const MAT = (color: number, metalness = 0): MeshStandardMaterial =>
  new MeshStandardMaterial({ color, roughness: 0.85, metalness });

interface MeshOptions {
  x?: number;
  y?: number;
  z?: number;
}

function mesh(
  geometry: BufferGeometry,
  material: Material,
  parent: Group,
  options: MeshOptions = {},
): Mesh {
  const renderedMesh = new Mesh(geometry, material);
  renderedMesh.position.set(options.x ?? 0, options.y ?? 0, options.z ?? 0);
  renderedMesh.castShadow = true;
  renderedMesh.receiveShadow = true;
  parent.add(renderedMesh);

  return renderedMesh;
}

function stick(
  parent: Group,
  start: Vector3,
  end: Vector3,
  options: { radius: number; material: Material },
): Mesh {
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
}

function arrowModel(): Group {
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

const bowModel = makeFieldBow;
const animateBow = deformBow;

function disposeGroup(group: Group): void {
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

function disposeArena(group: Group): void {
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
}

/** Declarative local API game. No supplied source code or remote assets are evaluated. */
export class BowGameRuntime {
  private lifecycle = 0;
  private collision: BowCollision | null = null;
  private grounded = false;
  private testClockPaused = false;
  private lastWorldImpact: Vector3 | null = null;
  private preview: {
    view: 'first-person' | 'character';
    draw: number;
    release: number;
    orbit: number;
    referenceTime?: number;
    aim?: boolean;
    flightSeconds?: number;
    flightSide?: boolean;
  } | null = null;
  /**
   * Applies deterministic visual inspection controls used by screenshots and regression tests.
   *
   * @param params - Requested camera, draw, release, reference, and flight preview values.
   * @returns Current serializable runtime state after applying the preview.
   */
  inspect(params: InspectOptions): object {
    if (!this.running) {
      throw new Error('Start bow game play mode before inspecting it');
    }

    if (params.resume) {
      this.preview = null;
      this.restart();

      return this.getState();
    }

    const flightSeconds = params.flightSeconds;
    const flightSide = params.flightSide;
    if (
      flightSeconds !== undefined &&
      (!Number.isFinite(flightSeconds) || flightSeconds < 0 || flightSeconds > 1)
    ) {
      throw new Error('flightSeconds must be within zero and one second');
    }

    if (flightSide !== undefined && typeof flightSide !== 'boolean') {
      throw new Error('flightSide must be boolean');
    }

    const view = params.view ?? 'first-person';
    const draw = params.draw ?? 0;
    const release = params.release ?? -1;
    const orbit = params.orbit ?? 0;
    const referenceTime = params.referenceTime;
    const aim = params.aim;
    if (
      !['first-person', 'character'].includes(view) ||
      !Number.isFinite(draw) ||
      draw < 0 ||
      draw > 1 ||
      !Number.isFinite(release) ||
      release < -1 ||
      release > 2 ||
      !Number.isFinite(orbit) ||
      Math.abs(orbit) > 180
    ) {
      throw new Error('Invalid bow inspection view, draw, release or orbit');
    }

    if (
      referenceTime !== undefined &&
      (!Number.isFinite(referenceTime) || referenceTime < 0 || referenceTime > 10)
    ) {
      throw new Error('referenceTime must be within the studied first ten seconds');
    }

    if (aim !== undefined && typeof aim !== 'boolean') {
      throw new Error('aim must be boolean');
    }

    if (this.preview?.flightSeconds !== undefined || flightSeconds !== undefined) {
      this.restart();
    }
    this.active = false;
    this.keys.clear();
    this.drawing = false;
    this.preview = { view, draw, release, orbit, referenceTime, aim, flightSeconds, flightSide };

    if (flightSeconds !== undefined) {
      this.preview.draw = 1;
      this.preview.aim = true;
      this.firePlayer(sampleReferenceAction(1, -1, 1), 1);

      for (let remaining = flightSeconds; remaining > 1e-10;) {
        const dt = Math.min(1 / 120, remaining);
        this.elapsed += dt;
        this.stepArrows(dt);
        remaining -= dt;
      }

      this.preview.release = flightSeconds;
    }

    this.updateCamera();
    this.updateHud();
    this.viewer.setDirty();

    return this.getState();
  }
  private running = false;
  private config?: BowGameConfig;
  private arenaRoot?: Group;
  private isPaused: () => boolean;
  private ownsArena: boolean;
  private session: BowNetSession | null;
  private performanceStats: BowPerformance | null;
  private root = new Group();
  private bots: Bot[] = [];
  private arrows: Arrow[] = [];
  private remotePlayers = new Map<string, RemotePlayer>();
  private trails: BowArrowTrails | null = null;
  private sceneBatch: ReturnType<typeof batchBowScene> | null = null;
  private lastHudUpdate = -1;
  private player = new Vector3();
  private velocity = new Vector3();
  private hp = 100;
  private kills = 0;
  private deaths = 0;
  private deadUntil = 0;
  private elapsed = 0;
  private winner = '';
  private yaw = 0;
  private pitch = 0;
  private keys = new Set<string>();
  private drawing = false;
  private charge = 0;
  private recoil = 0;
  private releaseTime = -1;
  private releasedCharge = 0;
  private leftArm?: ArmRig;
  private rightArm?: ArmRig;
  private posePhase = 'ready';
  private cooldown = 0;
  private aiming = false;
  private aimBlend = 0;
  private queuedDraw = false;
  private releaseFrom: ReferencePose | null = null;
  private cancelFrom: ReferencePose | null = null;
  private cancelTime = -1;
  private accumulator = 0;
  private overlay: HTMLDivElement | null = null;
  private hud: Record<string, HTMLElement> = {};
  private hudValues: Record<string, string | boolean> = Object.create(null);
  private bow = new Group();
  private heldArrow = new Group();
  private arm = new Group();
  private hand = new Group();
  private cameraRestore: CameraRestoreState | null = null;
  private sceneRestore: SceneRestoreState | null = null;
  private hidden: { object: Object3D; visible: boolean }[] = [];
  private flash = 0;
  private hit = 0;
  private message = '';
  private messageUntil = 0;
  private active = false;
  private hadPointerLock = false;
  private sounds: BowAudio | null = null;
  private networkSnapshot: NetSnapshot | null = null;
  private networkUnsubscribe: (() => void) | null = null;
  private networkAccumulator = 0;
  private networkSeq = 0;
  private arrowSeq = 0;
  private receivedHits = new Set<string>();
  /**
   * Creates an inert runtime; start performs asynchronous asset setup.
   *
   * @param viewer - Threepipe viewer that owns the active scene and camera.
   * @param options - Optional configuration, injected services, and arena ownership.
   */
  constructor(
    private viewer: ThreeViewer,
    options: BowGameRuntimeOptions = {},
  ) {
    this.config = options.config;
    this.arenaRoot = options.arenaRoot;
    this.isPaused = options.isPaused ?? (() => false);
    this.ownsArena = options.ownsArena ?? false;
    this.session = options.session ?? null;
    this.performanceStats = options.performanceStats ?? null;
  }
  /**
   * Returns whether a playable game configuration was supplied.
   *
   * @returns Whether start can create an active match.
   */
  isConfigured(): boolean {
    return Boolean(this.config);
  }

  private get requiredConfig(): BowGameConfig {
    if (!this.config) {
      throw new Error('Bow game runtime is not configured');
    }

    return this.config;
  }

  /**
   * Creates gameplay resources, installs input listeners, and enters the initial round.
   *
   * @returns Serializable state after startup completes or is superseded.
   */
  async start(): Promise<object> {
    if (this.running) {
      this.stop();
    }

    const lifecycle = ++this.lifecycle;

    if (!this.config) {
      return this.getState();
    }

    await preloadHumanAsset();

    if (lifecycle !== this.lifecycle) {
      return this.getState();
    }

    const viewer = this.viewer;
    const scene = viewer.scene;
    const camera = scene.mainCamera;
    const perspectiveCamera = camera as unknown as {
      fov?: number;
      updateProjectionMatrix?: () => void;
    };
    this.cameraRestore = {
      position: camera.position.clone(),
      quaternion: camera.quaternion.clone(),
      target: camera.target?.clone(),
      fov: perspectiveCamera.fov,
      controls: camera.controls?.enabled,
    };
    this.sceneRestore = {
      background: scene.background,
      fog: scene.fog,
      renderScale: viewer.renderManager.renderScale,
    };
    viewer.renderManager.renderScale = Math.min(viewer.renderManager.renderScale, 1.1);
    scene.background = new Color(0xa5b3b4);
    scene.fog = new FogExp2(0xa5b3b4, 0.012);

    for (const object of scene.modelRoot.children) {
      if (object.name !== 'K3D_BOW_DEMO_ARENA') {
        this.hidden.push({ object, visible: object.visible });
        object.visible = false;
      }
    }

    this.root = new Group();
    this.root.name = 'K3D_BOW_RUNTIME';
    scene.add(this.root);
    const arena =
      this.arenaRoot ??
      scene.modelRoot.children.find((object) => object.name === 'K3D_BOW_DEMO_ARENA');

    if (arena) {
      this.collision = new BowCollision(arena as Group);
      this.config.playerSpawn = this.collision.spawn(new Vector3().copy(this.config.playerSpawn));
      const collision = this.collision;
      this.config.botSpawns = this.config.botSpawns.map((spawn) =>
        collision.spawn(new Vector3().copy(spawn), 0.42),
      );
      this.sceneBatch = batchBowScene(arena as Group, this.root);
    }

    this.trails = new BowArrowTrails();
    this.root.add(this.trails.root);
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
    // Bots are intentionally absent online: remote rigs occupy the same gameplay
    // role, and mixing uncoordinated local AI into a trusted relay would diverge.
    this.bots = this.session
      ? []
      : Array.from({ length: this.config.botCount }, (_unusedValue, i) => this.createBot(i));
    this.bow = bowModel();
    this.bow.scale.setScalar(0.9);
    this.root.add(this.bow);
    this.heldArrow = arrowModel();
    this.root.add(this.heldArrow);
    const skin = firstPersonSkin();
    this.leftArm = makeArm(skin, -1);
    this.rightArm = makeArm(skin, 1);
    attachFirstPersonArm(this.leftArm, -1);
    attachFirstPersonArm(this.rightArm, 1);
    this.arm = this.leftArm.root;
    this.hand = this.rightArm.root;
    this.root.add(this.arm, this.hand);
    this.running = true;
    this.restart();
    this.makeHud();

    if (this.session) {
      this.networkUnsubscribe = this.session.onChange((message, snapshot) =>
        this.onNetwork(message, snapshot),
      );
      this.session.start();
    }

    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('keyup', this.onKeyUp, true);
    window.addEventListener('mousedown', this.onMouseDown, true);
    window.addEventListener('mouseup', this.onMouseUp, true);
    window.addEventListener('mousemove', this.onMouseMove, true);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('pointerlockchange', this.onLock);
    viewer.canvas.addEventListener('contextmenu', this.onContext);
    if (camera.controls) {
      camera.controls.enabled = false;
    }

    perspectiveCamera.fov = 76;
    perspectiveCamera.updateProjectionMatrix?.();
    this.performanceStats?.attachViewer(viewer);

    return this.getState();
  }
  /**
   * Removes all runtime resources and restores the viewer state captured by start.
   *
   * @returns Serializable inactive state after teardown.
   */
  stop(): object {
    this.lifecycle++;
    this.networkUnsubscribe?.();
    this.networkUnsubscribe = null;
    this.session?.stop();
    this.networkSnapshot = null;
    this.remotePlayers.clear();
    this.receivedHits.clear();
    this.performanceStats?.detachViewer();
    window.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('keyup', this.onKeyUp, true);
    window.removeEventListener('mousedown', this.onMouseDown, true);
    window.removeEventListener('mouseup', this.onMouseUp, true);
    window.removeEventListener('mousemove', this.onMouseMove, true);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('pointerlockchange', this.onLock);
    this.viewer.canvas.removeEventListener('contextmenu', this.onContext);
    if (document.pointerLockElement === this.viewer.canvas) {
      document.exitPointerLock();
    }
    this.keys.clear();
    this.preview = null;
    this.active = false;
    this.hadPointerLock = false;
    this.running = false;
    this.overlay?.remove();
    this.overlay = null;
    this.hud = {};
    this.hudValues = Object.create(null);
    this.collision?.dispose();
    this.collision = null;
    this.trails?.dispose();
    this.trails = null;
    this.sceneBatch?.dispose();
    this.sceneBatch = null;
    disposeGroup(this.root);
    this.arrows = [];
    this.bots = [];
    this.hidden.forEach((hiddenObject) => {
      hiddenObject.object.visible = hiddenObject.visible;
    });
    this.hidden = [];
    const viewer = this.viewer;

    if (viewer && this.cameraRestore) {
      const camera = viewer.scene.mainCamera;
      const restore = this.cameraRestore;
      const perspectiveCamera = camera as unknown as {
        fov?: number;
        updateProjectionMatrix?: () => void;
      };
      camera.position.copy(restore.position);
      camera.quaternion.copy(restore.quaternion);

      if (restore.target) {
        camera.target?.copy(restore.target);
      }

      if (camera.controls && restore.controls !== undefined) {
        camera.controls.enabled = restore.controls;
      }

      perspectiveCamera.fov = restore.fov;
      perspectiveCamera.updateProjectionMatrix?.();
      this.cameraRestore = null;
    }

    if (viewer && this.sceneRestore) {
      viewer.scene.background = this.sceneRestore.background;
      viewer.scene.fog = this.sceneRestore.fog;
      viewer.renderManager.renderScale = this.sceneRestore.renderScale;
      this.sceneRestore = null;
      viewer.setDirty();
    }

    if (this.ownsArena && this.arenaRoot) {
      disposeArena(this.arenaRoot);
      this.arenaRoot = undefined;
    }

    this.sounds?.dispose();
    this.sounds = null;

    return this.getState();
  }
  /**
   * Returns the serializable state consumed by tests, diagnostics, and the host component.
   *
   * @returns A detached runtime snapshot with no live Three.js objects.
   */
  getState(): Record<string, unknown> {
    return {
      collision: this.collision?.stats() ?? null,
      audio: this.sounds?.getState() ?? null,
      renderBatch: this.sceneBatch
        ? { originalMeshes: this.sceneBatch.originalMeshes, batches: this.sceneBatch.batches }
        : null,
      performance: this.performanceStats?.summary() ?? null,
      preview: this.preview,
      animation: { phase: this.posePhase, releaseSeconds: Number(this.releaseTime.toFixed(3)) },
      kind: 'bow-deathmatch',
      mode: this.session ? 'online' : 'solo',
      configured: this.isConfigured(),
      active: this.running,
      paused: !this.active || this.isPaused(),
      health: this.hp,
      kills: this.kills,
      deaths: this.deaths,
      scoreLimit: this.session
        ? (this.networkSnapshot?.scoreLimit ?? 20)
        : (this.config?.scoreLimit ?? 10),
      winner: this.winner,
      draw: Number(this.charge.toFixed(3)),
      arrowsInFlight: this.arrows.filter((arrow) => !arrow.stuck).length,
      elapsed: Number(this.elapsed.toFixed(2)),
      player: {
        id: this.networkSnapshot?.playerId ?? null,
        position: { x: this.player.x, y: this.player.y, z: this.player.z },
        yaw: this.yaw,
        pitch: this.pitch,
        alive: this.hp > 0,
      },
      bots: this.bots.map((bot) => ({
        name: bot.name,
        health: bot.hp,
        kills: bot.kills,
        deaths: bot.deaths,
        alive: bot.hp > 0,
        position: { x: bot.mesh.position.x, y: bot.mesh.position.y, z: bot.mesh.position.z },
        drawing: bot.draw > 0,
      })),
      remotePlayers: [...this.remotePlayers.values()].map((player) => ({
        id: player.id,
        name: player.name,
        slot: player.slot,
        alive: player.hp > 0,
        position: {
          x: player.mesh.position.x,
          y: player.mesh.position.y,
          z: player.mesh.position.z,
        },
        drawing: player.draw > 0,
      })),
      network: this.networkSnapshot,
      controls:
        'Click viewport • WASD move • mouse aim • hold/release LMB shoot • RMB aim • Shift sprint • Space jump • R restart • M mute • Esc pause',
    };
  }
  /**
   * Exercises the real collision fixed step only when an explicit test query parameter enables it.
   *
   * @param action - Optional position, yaw, step count, synthetic shot, and resume controls.
   * @returns Collision distances, player state, spawn validity, and BVH statistics.
   */
  collisionTest(action: CollisionTestAction = {}): object {
    if (
      typeof location === 'undefined' ||
      !new URLSearchParams(location.search).has('collisionTest')
    ) {
      throw new Error('Collision test hook disabled');
    }

    this.testClockPaused = true;

    if (action.position) {
      this.player.fromArray(action.position);
      this.velocity.set(0, 0, 0);
      this.grounded = false;
      this.lastWorldImpact = null;
      this.hp = 100;
    }

    if (action.yaw !== undefined) {
      this.yaw = action.yaw;
    }

    if (action.fire) {
      const fire = action.fire;
      this.spawnArrow(
        new Vector3().fromArray(fire.origin),
        new Vector3().fromArray(fire.direction).normalize().multiplyScalar(shotSpeed(1)),
        { owner: -1, isVisualOnly: Boolean(fire.remote) },
      );
    }

    for (let i = 0; i < Math.min(1200, action.steps ?? 0); i++) {
      this.step(1 / 120);
    }

    if (action.resume) {
      this.testClockPaused = false;
    }

    this.updateCamera();
    const impactPoint = this.lastWorldImpact;
    let rockDistance = Infinity;

    if (impactPoint && this.arenaRoot) {
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
            vertex
              .fromBufferAttribute(positions, vertexIndex)
              .applyMatrix4(renderedMesh.matrixWorld);
          });
          triangle.closestPointToPoint(impactPoint, closest);
          rockDistance = Math.min(rockDistance, closest.distanceTo(impactPoint));
        }
      });
    }

    return {
      rockDistance: Number.isFinite(rockDistance) ? rockDistance : null,
      position: this.player.toArray(),
      grounded: this.grounded,
      penetration: this.collision?.penetration(this.player),
      lastImpact: impactPoint?.toArray() ?? null,
      impactDistance: impactPoint
        ? this.collision?.bvh.closestPointToPoint(impactPoint)?.distance
        : null,
      stats: this.collision?.stats(),
      spawns: Array.from({ length: BOW_ROOM_CAP }, (_unusedValue, i) => {
        const spawn = this.slotSpawn(i);

        return { position: spawn.toArray(), penetration: this.collision?.penetration(spawn) };
      }),
    };
  }
  private createBot(i: number): Bot {
    const human = makeHuman(i);
    attachHumanAsset(human, i);
    const botRoot = human.root;
    botRoot.name = ['ASH', 'ROOK', 'VALE', 'FLINT', 'MOSS', 'BEAR'][i];
    const bow = bowModel();
    bow.scale.setScalar(1);
    bow.position.set(-0.22, 1.56, -0.6);
    botRoot.add(bow);
    const heldArrow = arrowModel();
    heldArrow.scale.setScalar(1);
    botRoot.add(heldArrow);
    this.root.add(botRoot);

    return {
      mesh: botRoot,
      name: botRoot.name,
      hp: 100,
      kills: 0,
      deaths: 0,
      cooldown: 2 + i,
      respawn: 0,
      phase: i * 2.1,
      draw: 0,
      leftLeg: human.legs[0].root,
      rightLeg: human.legs[1].root,
      bow,
      human,
      release: -1,
      heldArrow,
    };
  }
  private slotSpawn(slot: number) {
    if (slot === 0)
      return new Vector3(
        this.requiredConfig.playerSpawn.x,
        this.requiredConfig.playerSpawn.y,
        this.requiredConfig.playerSpawn.z,
      );
    const base = this.requiredConfig.botSpawns[(slot - 1) % this.requiredConfig.botSpawns.length],
      ring = Math.floor((slot - 1) / this.requiredConfig.botSpawns.length);
    const wanted = new Vector3(
      base.x + (ring % 2 ? 5 : -5) * ring,
      base.y,
      base.z + (ring % 2 ? -4 : 4) * ring,
    );

    return this.collision?.spawn(wanted) ?? wanted;
  }
  private createRemote(id: string, name: string, slot: number) {
    const human = makeHuman(slot);
    attachHumanAsset(human, slot);
    const remoteRoot = human.root;
    remoteRoot.name = `REMOTE_${id}`;
    const bow = bowModel();
    bow.scale.setScalar(1);
    bow.position.set(-0.22, 1.56, -0.6);
    remoteRoot.add(bow);
    const heldArrow = arrowModel();
    heldArrow.scale.setScalar(1);
    remoteRoot.add(heldArrow);
    const spawn = this.slotSpawn(slot);
    remoteRoot.position.copy(spawn);
    this.root.add(remoteRoot);
    const player: RemotePlayer = {
      id,
      slot,
      seq: -1,
      target: spawn.clone(),
      targetYaw: 0,
      targetPitch: 0,
      targetDraw: 0,
      anim: 'ready',
      mesh: remoteRoot,
      name,
      hp: 100,
      kills: 0,
      deaths: 0,
      cooldown: 0,
      respawn: 0,
      phase: slot * 2.1,
      draw: 0,
      leftLeg: human.legs[0].root,
      rightLeg: human.legs[1].root,
      bow,
      human,
      release: -1,
      heldArrow,
    };
    this.updateBotPose(player, { draw: 0 });
    this.remotePlayers.set(id, player);

    return player;
  }
  private syncRemotePlayers(snapshot: NetSnapshot) {
    const wanted = new Set<string>();

    for (const slot of snapshot.players) {
      if (slot.local) continue;
      wanted.add(slot.id);
      const player =
        this.remotePlayers.get(slot.id) ?? this.createRemote(slot.id, slot.name, slot.slot);
      player.name = slot.name;
      player.slot = slot.slot;
      player.kills = snapshot.scores[slot.id] ?? 0;
      player.deaths = slot.deaths;

      if (slot.seq >= 0) {
        player.seq = slot.seq;
        player.target.set(slot.pos.x, slot.pos.y, slot.pos.z);
        player.targetYaw = slot.yaw;
        player.targetPitch = slot.pitch;
        player.targetDraw = slot.draw;
        player.anim = slot.anim;
      }

      if (slot.anim === 'dead') {
        player.hp = 0;
        player.mesh.visible = false;
      } else if (player.hp <= 0) {
        player.hp = 100;
        player.mesh.visible = true;
      }
    }

    for (const [id, player] of this.remotePlayers)
      if (!wanted.has(id)) {
        disposeGroup(player.mesh);
        this.remotePlayers.delete(id);
      }
  }
  private onNetwork(message: ServerMessage | null, snapshot: NetSnapshot) {
    const previousId = this.networkSnapshot?.playerId;
    this.networkSnapshot = snapshot;
    this.syncRemotePlayers(snapshot);
    if (snapshot.playerId) this.kills = snapshot.scores[snapshot.playerId] ?? 0;
    const local = snapshot.players.find((player) => player.local);
    if (local) this.deaths = local.deaths;

    if (message?.type === 'welcome' && snapshot.playerId !== previousId) {
      const own = snapshot.players.find((player) => player.local);

      if (own) {
        this.player.copy(this.slotSpawn(own.slot));
        this.velocity.set(0, 0, 0);
        this.grounded = false;
        this.lastWorldImpact = null;
        this.hp = 100;
      }
    }

    if (message?.type === 'shot' && message.playerId !== snapshot.playerId) {
      this.spawnArrow(
        new Vector3(message.origin.x, message.origin.y, message.origin.z),
        new Vector3(message.velocity.x, message.velocity.y, message.velocity.z),
        {
          owner: 0,
          arrowId: message.arrowId,
          isVisualOnly: true,
          damage: shotDamage(1),
          sourcePlayerId: message.playerId,
        },
      );
    }

    if (message?.type === 'hit' && message.targetId === snapshot.playerId) {
      this.applyNetworkHit(message);
    }

    if (message?.type === 'death') {
      const player = this.remotePlayers.get(message.playerId);

      if (player) {
        player.hp = 0;
        player.mesh.visible = false;
      }
    }

    if (message?.type === 'round_end') {
      const winner = snapshot.players.find((player) => player.id === message.winnerId);
      this.winner = message.winnerId === snapshot.playerId ? 'YOU' : (winner?.name ?? 'ARCHER');
      this.message = `${this.winner} reached ${snapshot.scoreLimit} eliminations`;
      this.messageUntil = Infinity;
    }

    if (message?.type === 'round_reset') this.resetOnlineRound();

    if (message?.type === 'full') {
      this.message = 'Server full';
      this.messageUntil = Infinity;
    }

    this.updateHud();
  }
  private applyNetworkHit(message: Extract<ServerMessage, { type: 'hit' }>) {
    const key = `${message.playerId}:${message.arrowId}`;
    if (this.hp <= 0 || this.receivedHits.has(key)) return;
    this.receivedHits.add(key);
    this.hp = Math.max(0, this.hp - message.damage);
    this.flash = 1;
    this.sounds?.impact(
      this.player.clone().add(new Vector3(0, message.head ? 1.65 : 1.05, 0)),
      message.head ? 'head' : 'body',
    );

    if (this.hp > 0) {
      this.message = `${message.head ? 'HEADSHOT' : 'HIT'}  −${message.damage}`;
      this.messageUntil = this.elapsed + 1.7;

      return;
    }

    this.deaths++;
    this.deadUntil = this.elapsed + 3;
    this.drawing = false;
    this.charge = 0;
    this.session?.sendDeath(message.playerId);
    this.message = 'YOU WERE ELIMINATED';
    this.messageUntil = this.elapsed + 3;
  }
  private resetOnlineRound() {
    this.hp = 100;
    this.deadUntil = 0;
    this.winner = '';
    this.receivedHits.clear();
    const local = this.networkSnapshot?.players.find((player) => player.local);
    this.player.copy(this.slotSpawn(local?.slot ?? 0));
    this.velocity.set(0, 0, 0);
    this.grounded = false;
    this.lastWorldImpact = null;
    this.drawing = false;
    this.charge = 0;
    this.cooldown = 0;
    this.releaseTime = -1;
    this.message = 'NEW ROUND';
    this.messageUntil = this.elapsed + 2;
    this.arrows.forEach((arrow) => disposeGroup(arrow.mesh));
    this.arrows = [];
    this.trails?.clear();

    for (const player of this.remotePlayers.values()) {
      player.hp = 100;
      player.mesh.visible = true;
      player.target.copy(this.slotSpawn(player.slot));
    }
  }
  private updateBotPose(bot: Bot, options: BotPoseOptions): void {
    const walk = options.walk ?? 0;
    const isRelaxed = options.isRelaxed ?? false;
    const release = options.release ?? -1;
    const pose = sampleBowPose(options.draw, release, 1, this.elapsed);
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

    animateBow(bot.bow, pose.draw, pose.vibration);
    bot.heldArrow.visible = !isRelaxed && pose.arrowVisible;
    const nock = bowNock(pose.draw).applyQuaternion(bot.bow.quaternion).add(bot.bow.position);

    if (!isRelaxed) {
      poseArm(
        bot.human.left,
        new Vector3(-0.245, 1.44, 0),
        new Vector3(-0.29, 1.46, -0.31),
        bot.bow.position,
        bot.bow.quaternion,
      );
      if (release < 0.15 || release >= 1.05) {
        poseArm(
          bot.human.right,
          new Vector3(0.245, 1.44, 0),
          new Vector3(0.4 + pose.draw * 0.12, 1.38 + pose.draw * 0.08, -0.12 + pose.draw * 0.2),
          nock,
          bot.bow.quaternion,
        );
      }
    }

    bot.heldArrow.position
      .copy(nock)
      .add(new Vector3(0, 0, -0.28).applyQuaternion(bot.bow.quaternion));
    bot.heldArrow.quaternion.copy(bot.bow.quaternion);
    bot.human.applyPose?.(isRelaxed);
  }
  private restart() {
    this.preview = null;
    if (!this.config) return;
    const local = this.networkSnapshot?.players.find((player) => player.local);
    this.player.copy(this.session ? this.slotSpawn(local?.slot ?? 0) : this.config.playerSpawn);
    this.hp = 100;
    this.kills = 0;
    this.deaths = 0;
    this.deadUntil = 0;
    this.winner = '';
    this.elapsed = 0;
    this.yaw = 0;
    this.pitch = 0;
    this.velocity.set(0, 0, 0);
    this.grounded = false;
    this.lastWorldImpact = null;
    this.drawing = false;
    this.charge = 0;
    this.cooldown = 0;
    this.releaseTime = -1;
    this.releasedCharge = 0;
    this.releaseFrom = null;
    this.cancelFrom = null;
    this.cancelTime = -1;
    this.aimBlend = 0;
    this.aiming = false;
    this.queuedDraw = false;
    this.flash = 0;
    this.hit = 0;
    this.message = '';
    this.messageUntil = 0;
    this.accumulator = 0;
    this.networkAccumulator = 0;
    this.networkSeq = 0;
    this.receivedHits.clear();
    this.arrows.forEach((arrow) => disposeGroup(arrow.mesh));
    this.arrows = [];
    this.trails?.clear();
    this.bots.forEach((bot, i) => {
      bot.kills = 0;
      bot.deaths = 0;
      this.spawnBot(bot, i);
    });
    this.updateCamera();
  }
  private spawnBot(bot: Bot, i: number): void {
    const spawn = this.requiredConfig.botSpawns[i % this.requiredConfig.botSpawns.length];
    bot.mesh.position.set(spawn.x + (i >= 3 ? 3 : 0), spawn.y, spawn.z);

    if (bot.mesh.position.distanceTo(this.player) < 8) {
      bot.mesh.position.set(-bot.mesh.position.x, bot.mesh.position.y, -bot.mesh.position.z);
    }

    if (this.collision) {
      bot.mesh.position.copy(this.collision.spawn(bot.mesh.position, 0.42));
    }

    bot.velocity = new Vector3();
    bot.stuckTime = 0;
    bot.stuckAnchor = bot.mesh.position.clone();
    bot.escapeTarget = undefined;
    bot.hp = 100;
    bot.mesh.visible = true;
    bot.cooldown = 2 + i * 0.35;
    bot.draw = 0;
    bot.release = -1;
    bot.respawn = 0;
    this.updateBotPose(bot, { draw: 0 });
  }
  private typing(target: EventTarget | null): boolean {
    const element = target as HTMLElement;

    return Boolean(
      element &&
      (element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)),
    );
  }
  private onKeyDown = (event: KeyboardEvent): void => {
    if (
      !this.running ||
      this.typing(event.target) ||
      ![
        'KeyW',
        'KeyA',
        'KeyS',
        'KeyD',
        'ArrowUp',
        'ArrowDown',
        'ArrowLeft',
        'ArrowRight',
        'ShiftLeft',
        'ShiftRight',
        'Space',
        'KeyR',
        'KeyM',
      ].includes(event.code)
    ) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();

    if (event.code === 'KeyR' && !event.repeat) {
      if (!this.session) {
        this.restart();
      }
    } else if (event.code === 'KeyM' && !event.repeat) {
      if (this.sounds) {
        this.sounds.setMuted(!this.sounds.isMuted());
      }
    } else {
      this.keys.add(event.code);
    }
  };
  private onKeyUp = (event: KeyboardEvent): void => {
    if (this.keys.delete(event.code)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  private onContext = (event: Event): void => event.preventDefault();
  private onMouseDown = (event: MouseEvent): void => {
    if (!this.running || event.target !== this.viewer.canvas) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();

    if (!this.active) {
      this.enter();

      return;
    }

    if (event.button === 0 && this.hp > 0 && !this.winner) {
      if (this.cooldown <= 0 && this.cancelTime < 0) {
        this.drawing = true;
      } else {
        this.queuedDraw = true;
      }
    }

    if (event.button === 2) {
      this.aiming = true;
    }
  };
  private enter = () => {
    if (this.preview) this.restart();

    if (this.session) {
      const input = this.hud.name as HTMLInputElement | undefined;
      if (input) this.session.setName(input.value);
      if (this.networkSnapshot?.status !== 'connected') return;
    }

    const canvas = this.viewer.canvas;

    try {
      const pending = canvas.requestPointerLock();
      if (pending instanceof Promise) {
        void pending.catch((error: unknown) => {
          console.warn('Pointer lock request was rejected.', { error });
          this.message = 'Pointer lock unavailable — drag on canvas to aim';
          this.messageUntil = this.elapsed + 8;
        });
      }
    } catch (error: unknown) {
      console.warn('Pointer lock is unavailable in this browser.', { error });
    }

    this.active = true;
    this.sounds ??= new BowAudio();
    this.sounds.resume().catch((error: unknown) => {
      console.warn('Bow audio could not be resumed.', { error });
    });
  };
  private onMouseUp = (event: MouseEvent): void => {
    if (!this.running) {
      return;
    }

    if (event.button === 0) {
      this.queuedDraw = false;

      if (this.drawing) {
        const from = this.sampleLivePose();

        if (this.charge > 0.6 && this.hp > 0 && !this.winner) {
          this.firePlayer(from, this.charge);
          this.recoil = 1;
          this.releaseTime = 0;
          this.releasedCharge = this.charge;
          this.releaseFrom = from;
          this.cancelFrom = null;
          this.cancelTime = -1;
          this.cooldown = BOW_RELEASE_SECONDS;
        } else if (this.charge > 0) {
          this.cancelFrom = from;
          this.cancelTime = 0;
        }

        this.drawing = false;
        this.charge = 0;
      }
    }

    if (event.button === 2) {
      this.aiming = false;
    }
  };
  private onMouseMove = (event: MouseEvent): void => {
    if (!this.running || !this.active) {
      return;
    }

    // MouseEvent.buttons is a documented bit flag; bit 0 represents the primary button.
    if (document.pointerLockElement !== this.viewer.canvas && !(event.buttons & 1)) {
      return;
    }

    this.yaw -= event.movementX * (this.aiming ? 0.0011 : 0.0018);
    this.pitch = Math.max(
      -1.25,
      Math.min(1.25, this.pitch - event.movementY * (this.aiming ? 0.0011 : 0.0018)),
    );
    event.stopImmediatePropagation();
  };
  private onBlur = () => {
    this.keys.clear();

    if (this.drawing && this.charge > 0) {
      this.cancelFrom = this.sampleLivePose();
      this.cancelTime = 0;
    }

    this.drawing = false;
    this.charge = 0;
    this.queuedDraw = false;
    this.aiming = false;
    this.active = false;
    this.sounds?.suspend();
  };
  private onLock = () => {
    if (document.pointerLockElement === this.viewer.canvas) {
      this.hadPointerLock = true;
      this.active = true;
    } else if (this.hadPointerLock) {
      this.hadPointerLock = false;
      this.onBlur();
    }
  };

  private firePlayer(pose: ReferencePose, charge: number) {
    // The rendered arrowhead is the sight: launch from that same point along its camera ray.
    this.updateCamera();
    const camera = this.viewer.scene.mainCamera;
    const tip = referenceArrow(pose).tip;
    const origin = tip.clone().applyQuaternion(camera.quaternion).add(camera.position);
    const direction = tip.clone().normalize().applyQuaternion(camera.quaternion);
    this.fire(origin, direction, -1, charge);
  }
  private fire(position: Vector3, direction: Vector3, owner: number, charge: number) {
    const velocity = direction.multiplyScalar(shotSpeed(charge));
    const arrowId =
      this.session && owner < 0
        ? `${this.networkSnapshot?.playerId ?? 'pending'}-${++this.arrowSeq}`
        : undefined;
    this.spawnArrow(position, velocity, {
      owner,
      arrowId,
      isVisualOnly: false,
      damage: shotDamage(charge),
    });

    if (arrowId) {
      this.session?.sendShot(
        arrowId,
        { x: position.x, y: position.y, z: position.z },
        { x: velocity.x, y: velocity.y, z: velocity.z },
      );
    }
  }
  private spawnArrow(position: Vector3, velocity: Vector3, options: SpawnArrowOptions): void {
    const damage = options.damage ?? shotDamage(1);
    const isVisualOnly = options.isVisualOnly ?? false;
    const owner = options.owner;
    this.sounds?.release(owner < 0 ? undefined : position, owner);
    const model = arrowModel();
    model.position.copy(position);
    this.root.add(model);

    if (!this.trails) {
      this.trails = new BowArrowTrails();
      this.root.add(this.trails.root);
    }

    const trail = this.trails.spawn(position, this.elapsed);
    this.arrows.push({
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

    if (this.arrows.length > 90) {
      const oldestArrow = this.arrows.shift();

      if (oldestArrow) {
        this.trails.remove(oldestArrow.trail);
        disposeGroup(oldestArrow.mesh);
      }
    }
  }
  /**
   * Advances input, simulation, animation, networking, telemetry, and HUD state for one frame.
   *
   * @param deltaTime - Browser frame delta in milliseconds.
   * @param time - Current Performance timeline timestamp in milliseconds.
   * @returns Whether the runtime remains active and needs rendering.
   */
  update(deltaTime: number, time = performance.now()): boolean {
    if (!this.running) {
      return false;
    }

    const start = performance.now();
    const frameMs = Math.max(0, deltaTime);
    const dt = Math.min(frameMs / 1000, 0.08);
    const active = this.active && !this.isPaused() && !this.winner;

    if (active && !this.testClockPaused) {
      this.accumulator += dt;

      while (this.accumulator >= 1 / 120) {
        this.step(1 / 120);
        this.accumulator -= 1 / 120;
      }
    }

    for (const bot of this.bots) {
      if (bot.hp > 0) {
        this.updateBotPose(bot, { draw: bot.draw, walk: bot.walk, release: bot.release });
      }
    }

    for (const player of this.remotePlayers.values()) {
      if (player.hp > 0) {
        this.updateBotPose(player, {
          draw: player.draw,
          walk: player.walk,
          release: player.release,
        });
        player.bow.rotation.x += player.targetPitch * 0.25;
      }
    }

    this.updateCamera();

    if (time - this.lastHudUpdate > 33) {
      this.updateHud();
      this.lastHudUpdate = time;
      this.sounds?.draw(-1, active && this.hp > 0 && this.drawing ? this.charge : 0);
      for (let i = 0; i < this.bots.length; i++)
        this.sounds?.draw(
          i,
          active && this.bots[i].hp > 0 ? this.bots[i].draw : 0,
          this.bots[i].mesh.position,
        );
    }

    this.performanceStats?.record(time, frameMs, performance.now() - start, active);

    return true;
  }
  private step(dt: number) {
    this.elapsed += dt;
    this.aimBlend += Math.max(-dt / 0.4, Math.min(dt / 0.4, Number(this.aiming) - this.aimBlend));

    if (this.releaseTime >= 0) {
      this.releaseTime += dt;

      if (this.releaseTime >= BOW_RELEASE_SECONDS) {
        this.releaseTime = -1;
        this.releaseFrom = null;
      }
    }

    if (this.cancelTime >= 0) {
      this.cancelTime += dt;

      if (this.cancelTime >= 0.3) {
        this.cancelTime = -1;
        this.cancelFrom = null;
      }
    }

    this.cooldown = Math.max(0, this.cooldown - dt);

    if (
      this.queuedDraw &&
      this.cooldown <= 0 &&
      this.cancelTime < 0 &&
      this.hp > 0 &&
      !this.winner
    ) {
      this.drawing = true;
      this.charge = 0;
      this.queuedDraw = false;
    }

    this.recoil = Math.max(0, this.recoil - dt * 5);
    this.flash = Math.max(0, this.flash - dt * 1.8);
    this.hit = Math.max(0, this.hit - dt * 2.8);

    if (this.hp <= 0) {
      if (this.elapsed >= this.deadUntil) {
        this.hp = 100;
        const local = this.networkSnapshot?.players.find((player) => player.local);
        this.player.copy(
          this.session ? this.slotSpawn(local?.slot ?? 0) : this.requiredConfig.playerSpawn,
        );
        this.velocity.set(0, 0, 0);
        this.grounded = false;
        this.lastWorldImpact = null;
      }
    } else {
      const x =
          Number(this.keys.has('KeyD') || this.keys.has('ArrowRight')) -
          Number(this.keys.has('KeyA') || this.keys.has('ArrowLeft')),
        z =
          Number(this.keys.has('KeyS') || this.keys.has('ArrowDown')) -
          Number(this.keys.has('KeyW') || this.keys.has('ArrowUp'));
      const length = Math.hypot(x, z) || 1;
      const isSprinting =
        (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) && !this.drawing;
      let speed = 4.5;

      if (this.drawing) {
        speed = 2.6;
      } else if (isSprinting) {
        speed = 7;
      }

      const dx = ((x * Math.cos(this.yaw) + z * Math.sin(this.yaw)) / length) * speed * dt;
      const dz = ((-x * Math.sin(this.yaw) + z * Math.cos(this.yaw)) / length) * speed * dt;

      if (this.collision) {
        this.velocity.x = dx / dt;
        this.velocity.z = dz / dt;

        if (this.keys.has('Space') && this.grounded) {
          this.velocity.y = 4.8;
          this.grounded = false;
        }

        this.velocity.y -= GRAVITY * dt;
        this.grounded = this.collision.move(this.player, this.velocity, dt);
      } else {
        // Legacy geometry-free harness callers; the hosted arena always owns a BVH.
        this.player.copy(moveWithCover(this.player, dx, dz, this.requiredConfig.obstacles));
        if (this.keys.has('Space') && this.player.y === 0) {
          this.velocity.y = 4.8;
        }

        this.velocity.y -= GRAVITY * dt;
        this.player.y = Math.max(0, this.player.y + this.velocity.y * dt);

        if (this.player.y === 0) {
          this.velocity.y = 0;
        }
      }

      if (this.drawing) {
        this.charge = Math.min(1, this.charge + dt / BOW_DRAW_SECONDS);
      }
    }

    this.bots.forEach((bot, i) => this.stepBot(bot, i, dt));
    this.stepRemotePlayers(dt);
    this.stepArrows(dt);
    this.sendNetworkState(dt);
  }
  private stepRemotePlayers(dt: number): void {
    for (const player of this.remotePlayers.values()) {
      const before = player.mesh.position.clone();
      const blend = 1 - Math.exp(-dt * 12);
      player.mesh.position.lerp(player.target, blend);
      player.mesh.rotation.y += (player.targetYaw - player.mesh.rotation.y) * blend;
      player.draw += (player.targetDraw - player.draw) * blend;
      const isMoving = before.distanceTo(player.mesh.position) > dt * 0.2;
      player.walk =
        player.anim === 'walk' || isMoving ? Math.sin(this.elapsed * 7 + player.phase) : 0;

      if (player.anim === 'release') {
        if (player.release < 0) {
          player.release = 0;
        } else {
          player.release = Math.min(1.05, player.release + dt);
        }
      } else {
        player.release = -1;
      }
    }
  }
  private sendNetworkState(dt: number): void {
    if (!this.session) {
      return;
    }

    this.networkAccumulator += dt;

    if (this.networkAccumulator < 0.05) {
      return;
    }

    this.networkAccumulator %= 0.05;
    const moving =
      this.keys.has('KeyW') ||
      this.keys.has('KeyA') ||
      this.keys.has('KeyS') ||
      this.keys.has('KeyD') ||
      this.keys.has('ArrowUp') ||
      this.keys.has('ArrowDown') ||
      this.keys.has('ArrowLeft') ||
      this.keys.has('ArrowRight');
    let animation: PlayerAnim = 'ready';

    if (this.hp <= 0) {
      animation = 'dead';
    } else if (this.releaseTime >= 0) {
      animation = 'release';
    } else if (this.drawing) {
      animation = 'draw';
    } else if (moving) {
      animation = 'walk';
    }

    this.session.sendState({
      seq: ++this.networkSeq,
      pos: { x: this.player.x, y: this.player.y, z: this.player.z },
      yaw: this.yaw,
      pitch: this.pitch,
      draw: this.charge,
      anim: animation,
    });
  }
  private stepBot(bot: Bot, index: number, dt: number): void {
    if (bot.hp <= 0) {
      if (this.elapsed > bot.respawn) {
        this.spawnBot(bot, index);
      }

      return;
    }

    const target = this.player.clone().add(new Vector3(0, 1.28, 0));
    const origin = bot.mesh.position.clone().add(new Vector3(0, 1.34, 0));
    const delta = target.clone().sub(origin);
    const distance = delta.length();
    bot.mesh.rotation.y = Math.atan2(-delta.x, -delta.z);
    bot.cooldown -= dt;

    if (bot.release >= 0) {
      bot.release += dt;
      if (bot.release >= 1.05) {
        bot.release = -1;
      }
    }

    const blocked = this.collision
      ? this.collision.segment(origin, target) !== null
      : this.requiredConfig.obstacles.some((cover) => segmentCover(origin, target, cover) !== null);
    let advance = 0.05;

    if (distance > 17) {
      advance = 1;
    } else if (distance < 9) {
      advance = -0.8;
    }

    const toward = delta.clone().setY(0).normalize();
    const side = new Vector3(-toward.z, 0, toward.x);
    const movement = toward
      .multiplyScalar(blocked ? 1 : advance)
      .addScaledVector(side, blocked ? 1 : 0.7)
      .normalize()
      .multiplyScalar((bot.draw ? 1.2 : 2.1) * dt);
    const old = bot.mesh.position.clone();
    if (this.collision) {
      if (bot.escapeTarget) {
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

      bot.velocity ??= new Vector3();
      bot.velocity.x = movement.x / dt;
      bot.velocity.z = movement.z / dt;
      bot.velocity.y -= GRAVITY * dt;
      this.collision.move(bot.mesh.position, bot.velocity, dt, 0.42);
      bot.stuckAnchor ??= old.clone();
      bot.stuckTime = (bot.stuckTime ?? 0) + dt;

      if (bot.stuckTime >= 1.5) {
        if (bot.mesh.position.distanceTo(bot.stuckAnchor) < 0.2) {
          const angle = Math.random() * Math.PI * 2;
          bot.escapeTarget = old
            .clone()
            .add(new Vector3(Math.cos(angle) * 4, 0, Math.sin(angle) * 4));
        }

        bot.stuckAnchor.copy(bot.mesh.position);
        bot.stuckTime = 0;
      }
    } else {
      bot.mesh.position.copy(
        moveWithCover(old, movement.x, movement.z, this.requiredConfig.obstacles, 0.42),
      );
    }
    const walking = old.distanceTo(bot.mesh.position) > dt * 0.2;
    bot.leftLeg.rotation.x = walking ? Math.sin(this.elapsed * 7 + bot.phase) * 0.5 : 0;
    bot.rightLeg.rotation.x = -bot.leftLeg.rotation.x;
    if (this.hp > 0 && !blocked && distance < 38 && bot.cooldown <= 0) {
      bot.draw += dt / 1.1;

      if (bot.draw >= 1) {
        const level = this.requiredConfig.difficulty;
        let spread = 0.045;
        let cooldown = 2.6;

        if (level === 'easy') {
          spread = 0.1;
          cooldown = 3.4;
        } else if (level === 'hard') {
          spread = 0.017;
          cooldown = 1.7;
        }

        const speed = shotSpeed(0.85);
        target.y += GRAVITY * 0.5 * Math.pow(distance / speed, 2);
        target.x += (Math.random() - 0.5) * distance * spread;
        target.y += (Math.random() - 0.5) * distance * spread;
        this.fire(origin, target.sub(origin).normalize(), index, 0.85);
        bot.draw = 0;
        bot.release = 0;
        bot.cooldown = cooldown + Math.random();
      }
    } else {
      bot.draw = Math.max(0, bot.draw - dt * 2);
    }
    bot.walk = walking ? Math.sin(this.elapsed * 7 + bot.phase) : 0;
  }
  private arrowCandidates(arrow: Arrow): ArrowCandidate[] {
    if (arrow.visualOnly) {
      const remoteCandidates = [...this.remotePlayers.values()]
        .filter((player) => player.id !== arrow.sourcePlayerId)
        .map((player) => ({
          position: player.mesh.position,
          hp: player.hp,
          index: player.id,
        }));

      return [{ position: this.player, hp: this.hp, index: -1 }, ...remoteCandidates];
    }

    if (this.session && arrow.owner < 0) {
      return [...this.remotePlayers.values()].map((player) => ({
        position: player.mesh.position,
        hp: player.hp,
        index: player.id,
      }));
    }

    if (arrow.owner < 0) {
      return this.bots.map((bot, i) => ({
        position: bot.mesh.position,
        hp: bot.hp,
        index: i,
      }));
    }

    return [{ position: this.player, hp: this.hp, index: -1 }];
  }

  private findArrowIntersection(from: Vector3, to: Vector3, arrow: Arrow): ArrowIntersection {
    const intersection: ArrowIntersection = {
      nearest: 1,
      victim: null,
      isHead: false,
      hasCollided: false,
    };

    if (this.collision) {
      const hit = this.collision.segment(from, to);

      if (hit) {
        intersection.nearest = hit.t;
        intersection.hasCollided = true;
      }
    } else {
      if (to.y <= 0.025) {
        intersection.nearest = Math.max(0, (from.y - 0.025) / (from.y - to.y));
        intersection.hasCollided = true;
      }

      for (const cover of this.requiredConfig.obstacles) {
        const coverTime = segmentCover(from, to, cover);

        if (coverTime !== null && coverTime <= intersection.nearest) {
          intersection.nearest = coverTime;
          intersection.victim = null;
          intersection.hasCollided = true;
        }
      }
    }

    for (const candidate of this.arrowCandidates(arrow)) {
      this.testArrowCandidate(from, to, candidate, intersection);
    }

    return intersection;
  }

  private testArrowCandidate(
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

  private handleArrowCollision(arrow: Arrow, intersection: ArrowIntersection): void {
    const { victim, isHead } = intersection;

    if (victim === null) {
      this.lastWorldImpact = arrow.position.clone();
    }

    let impactKind: 'head' | 'body' | 'cover' = 'cover';

    if (isHead) {
      impactKind = 'head';
    } else if (victim !== null) {
      impactKind = 'body';
    }

    this.sounds?.impact(arrow.position, impactKind);
    this.trails?.stop(arrow.trail);
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
      if (isHead) {
        this.sounds?.headshotConfirm();
      }

      this.hit = 1;
      const remote = this.remotePlayers.get(victim);
      this.message = `${isHead ? 'HEADSHOT' : 'HIT'}  −${damage}  ${remote?.name ?? 'ARCHER'}`;
      this.messageUntil = this.elapsed + 1.7;

      if (arrow.arrowId) {
        this.session?.sendHit(victim, arrow.arrowId, damage, isHead);
      }
    } else {
      this.damage(victim, damage, arrow.owner, isHead);
    }

    arrow.mesh.visible = false;
  }

  private stepArrows(dt: number): void {
    for (const arrow of [...this.arrows]) {
      arrow.age += dt;

      if (arrow.age > 12) {
        this.trails?.remove(arrow.trail);
        disposeGroup(arrow.mesh);
        this.arrows.splice(this.arrows.indexOf(arrow), 1);
        continue;
      }

      if (arrow.stuck) {
        continue;
      }

      const from = arrow.position.clone();
      arrow.velocity.y -= GRAVITY * dt;
      const to = from.clone().addScaledVector(arrow.velocity, dt);
      const intersection = this.findArrowIntersection(from, to, arrow);

      arrow.position.copy(from).lerp(to, intersection.nearest);
      this.trails?.sample(arrow.trail, arrow.position, this.elapsed);
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
        this.sounds?.whizz(from, to)
      ) {
        arrow.whizzed = true;
      }

      if (intersection.hasCollided) {
        this.handleArrowCollision(arrow, intersection);
      }

      if (arrow.position.length() > 110) {
        this.trails?.remove(arrow.trail);
        disposeGroup(arrow.mesh);
        this.arrows.splice(this.arrows.indexOf(arrow), 1);
      }
    }
  }
  private damage(victim: number, damage: number, owner: number, isHead: boolean): void {
    if (isHead && owner < 0 && victim >= 0) {
      this.sounds?.headshotConfirm();
    }

    if (victim === -1) {
      this.hp = Math.max(0, this.hp - damage);
      this.flash = 1;

      if (!this.hp) {
        this.deaths++;
        this.deadUntil = this.elapsed + 3;
        this.drawing = false;
        this.charge = 0;
        this.bots[owner].kills++;
        this.message = `${this.bots[owner].name} eliminated you`;
        this.messageUntil = this.elapsed + 3;
      }
    } else {
      const bot = this.bots[victim];
      bot.hp = Math.max(0, bot.hp - damage);
      this.hit = 1;
      this.message = `${isHead ? 'HEADSHOT' : 'HIT'}  −${damage}  ${bot.name}`;
      this.messageUntil = this.elapsed + 1.7;

      if (!bot.hp) {
        bot.deaths++;
        bot.respawn = this.elapsed + 3.5;
        bot.mesh.visible = false;
        this.kills++;
        this.message = `${bot.name} eliminated  +1`;
      }
    }

    if (this.kills >= this.requiredConfig.scoreLimit) {
      this.winner = 'YOU';
    }

    const winningBot = this.bots.find((bot) => bot.kills >= this.requiredConfig.scoreLimit);

    if (winningBot) {
      this.winner = winningBot.name;
    }
  }
  /**
   * Samples input-driven reference transitions using simulation time only.
   *
   * @returns Current local archer pose in normalized reference coordinates.
   */
  private sampleLivePose(): ReferencePose {
    if (this.releaseTime >= 0) {
      const target = sampleReferenceAction(0, this.releaseTime, this.aimBlend);
      if (!this.releaseFrom) {
        return target;
      }

      const progress = Math.min(1, this.releaseTime / 0.14);
      const smoothProgress = progress * progress * (3 - 2 * progress);

      return {
        ...blendReferencePoses(this.releaseFrom, target, smoothProgress),
        arrowVisible: false,
        rightVisible: false,
        phase: target.phase,
      };
    }

    if (this.cancelTime >= 0 && this.cancelFrom) {
      const from = this.cancelFrom;
      const target = sampleReferenceAction(0);
      const progress = Math.min(1, this.cancelTime / 0.3);
      const smoothProgress = progress * progress * (3 - 2 * progress);
      // Keep the same arrow in the hand while it is lowered completely below the viewport.
      target.arrowTip = [from.arrowTip[0], 1.35];
      target.arrowNear = [from.arrowNear[0], 1.95];
      const pose = blendReferencePoses(from, target, smoothProgress);

      return {
        ...pose,
        arrowVisible: from.arrowVisible && progress < 1,
        rightVisible: from.rightVisible && progress < 1,
        arrowSeated: from.arrowSeated,
        phase: 'cancel',
      };
    }

    return sampleReferenceAction(this.charge, -1, this.aimBlend);
  }
  private updateCamera() {
    if (!this.running) return;
    this.trails?.update(this.elapsed, this.viewer.scene.mainCamera.position);

    if (this.preview?.view === 'character') {
      const camera = this.viewer.scene.mainCamera;
      const bot = this.bots[0];
      this.bow.visible = false;
      this.arm.visible = false;
      this.hand.visible = false;
      this.heldArrow.visible = false;
      this.bots.forEach((candidate, i) => {
        candidate.mesh.visible = i === 0;
      });
      const angle = (this.preview.orbit * Math.PI) / 180;
      bot.mesh.position.set(0, 0, 17);
      bot.mesh.rotation.set(0, 0, 0);
      bot.leftLeg.rotation.set(0, 0, 0);
      bot.rightLeg.rotation.set(0, 0, 0);
      this.updateBotPose(bot, {
        draw: this.preview.draw,
        isRelaxed: this.preview.draw === 0 && this.preview.release < 0,
        release: this.preview.release,
      });
      camera.position.set(Math.sin(angle) * 3.15, 0.98, 17 - Math.cos(angle) * 3.15);
      camera.lookAt(0, 0.98, 17);
      camera.target?.set(0, 0.98, 17);
      const perspectiveCamera = camera as unknown as {
        fov?: number;
        updateProjectionMatrix?: () => void;
      };
      perspectiveCamera.fov = this.preview.draw > 0 || this.preview.release >= 0 ? 48 : 40;
      perspectiveCamera.updateProjectionMatrix?.();
      camera.setDirty?.({ change: 'transform' });

      return;
    }

    if (this.preview) {
      this.charge = this.preview.draw;
    }

    const camera = this.viewer.scene.mainCamera;

    if (camera.controls) {
      camera.controls.enabled = false;
    }

    const walk = this.keys.size > 0 && this.hp > 0 && this.active;
    camera.position.copy(this.player).add(new Vector3(0, this.hp > 0 ? 1.66 : 0.55, 0));

    if (walk) {
      camera.position.y += Math.sin(this.elapsed * 10) * 0.025;
    }

    camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    const direction = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    camera.target?.copy(camera.position).add(direction);
    const wanted = 76;
    const perspectiveCamera = camera as unknown as {
      fov?: number;
      updateProjectionMatrix?: () => void;
    };
    perspectiveCamera.fov = wanted;
    perspectiveCamera.updateProjectionMatrix?.();
    camera.setDirty?.({ change: 'transform' });
    this.sounds?.setListener(
      camera.position,
      new Vector3(1, 0, 0).applyQuaternion(camera.quaternion),
    );
    const cameraRotation = camera.quaternion;
    const release = this.preview?.release ?? this.releaseTime;
    let pose: ReferencePose;

    if (this.preview?.referenceTime !== undefined) {
      pose = sampleReferenceTimeline(this.preview.referenceTime);
    } else if (this.preview) {
      pose = sampleReferenceAction(
        this.preview.draw,
        release,
        (this.preview.aim ?? this.aiming) ? 1 : 0,
      );
    } else {
      pose = this.sampleLivePose();
    }

    this.posePhase = pose.phase;
    const localRotation = referenceRotation(pose);
    const grip = referenceScreenPoint(...pose.grip);
    const scale = 0.9;
    this.bow.position.copy(grip).applyQuaternion(cameraRotation).add(camera.position);
    this.bow.quaternion.copy(cameraRotation).multiply(localRotation);
    this.bow.scale.setScalar(scale);
    animateBow(
      this.bow,
      pose.tension,
      release >= 0 ? Math.sin(release * 115) * Math.exp(-release * 24) * 0.025 : 0,
    );
    this.arm.position.copy(camera.position);
    this.hand.position.copy(camera.position);
    this.arm.quaternion.copy(cameraRotation);
    this.hand.quaternion.copy(cameraRotation);
    const arrow = referenceArrow(pose);
    const nock = arrow.nock;

    if (pose.arrowVisible && pose.arrowSeated) {
      const localNock = nock
        .clone()
        .sub(grip)
        .applyQuaternion(localRotation.clone().invert())
        .divideScalar(scale);
      const string = this.bow.userData.bowString as Line;
      const points = string.geometry.getAttribute('position');
      points.setXYZ(1, localNock.x, localNock.y, localNock.z);
      points.needsUpdate = true;
      string.geometry.computeBoundingSphere();
    }

    const pull = pose.arrowVisible ? nock : referenceScreenPoint(...pose.right);
    this.leftArm?.setFingerRelease?.(pose.leftOpen);
    this.rightArm?.setFingerRelease?.(pose.rightOpen);
    if (this.leftArm) {
      poseArm(
        this.leftArm,
        new Vector3(-0.68, -0.55, 0.12),
        new Vector3(-0.54, -0.42, -0.35),
        grip,
        localRotation,
      );
    }

    if (this.rightArm && pose.rightVisible) {
      poseArm(
        this.rightArm,
        new Vector3(0.5, -0.6, 0.08),
        new Vector3(0.48, -0.45, -0.06),
        pull,
        new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -0.15),
      );
    }
    // The full-draw nock and pulling hand retreat below the camera exactly as in the supplied clip.
    this.hand.visible = this.hp > 0 && pose.rightVisible;
    this.arm.visible = this.hp > 0;
    this.bow.visible = this.hp > 0;
    const arrowAnchor = nock;
    const arrowRotation = arrow.rotation;
    this.heldArrow.position
      .copy(arrowAnchor)
      .add(new Vector3(0, 0, -0.28 * scale).applyQuaternion(arrowRotation))
      .applyQuaternion(cameraRotation)
      .add(camera.position);
    this.heldArrow.quaternion.copy(cameraRotation).multiply(arrowRotation);
    this.heldArrow.scale.setScalar(scale);
    this.heldArrow.visible = this.hp > 0 && pose.arrowVisible;

    if (this.preview?.flightSeconds !== undefined) {
      this.heldArrow.visible = false;

      if (this.preview.flightSide && this.arrows[0]) {
        const point = this.arrows[0].position;
        this.bow.visible = false;
        this.arm.visible = false;
        this.hand.visible = false;
        camera.position.copy(point).add(new Vector3(8, 2, 5));
        camera.lookAt(point.x, point.y, point.z + 3);
        camera.target?.set(point.x, point.y, point.z + 3);
        camera.setDirty?.({ change: 'transform' });
      }
    }

    this.trails?.update(this.elapsed, camera.position);
  }

  private setHudText(id: string, value: string): void {
    const key = `text:${id}`;

    if (this.hudValues[key] === value) {
      return;
    }

    this.hudValues[key] = value;
    this.hud[id].textContent = value;
  }

  private setHudStyle(id: string, property: string, value: string): void {
    const key = `style:${id}:${property}`;

    if (this.hudValues[key] === value) {
      return;
    }

    this.hudValues[key] = value;
    this.hud[id].style.setProperty(property, value);
  }

  private setHudDisabled(id: string, value: boolean): void {
    const key = `disabled:${id}`;

    if (this.hudValues[key] === value) {
      return;
    }

    this.hudValues[key] = value;
    (this.hud[id] as HTMLButtonElement).disabled = value;
  }

  private makeHud(): void {
    this.hudValues = Object.create(null);
    const overlay = document.createElement('div');
    overlay.id = 'kite3d-bow-game-hud';
    overlay.style.cssText =
      'position:fixed;z-index:10000;pointer-events:none;color:#ecece3;font:13px system-ui,sans-serif;overflow:hidden;';
    this.hud.overlay = overlay;

    const add = (id: string, style: string, text = ''): HTMLDivElement => {
      const element = document.createElement('div');
      element.style.cssText = style;
      element.textContent = text;
      overlay.append(element);
      this.hud[id] = element;
      this.hudValues[`text:${id}`] = text;

      return element;
    };

    add(
      'brand',
      'position:absolute;left:28px;top:24px;font-size:13px;letter-spacing:5px;font-weight:800;',
      'TIMBER / ASH',
    );
    add(
      'sub',
      'position:absolute;left:29px;top:46px;font-size:10px;letter-spacing:2px;color:#c8c9b7;',
      'BOW DEATHMATCH · LOCAL BOT ARENA',
    );
    add(
      'score',
      'position:absolute;top:24px;right:28px;text-align:right;font-size:15px;font-weight:700;',
    );
    add(
      'board',
      'position:absolute;right:28px;top:56px;line-height:23px;color:#d0d0c4;white-space:pre;text-align:right;font-size:11px;',
    );
    if (this.session) {
      add(
        'network',
        'position:absolute;left:29px;top:65px;font-size:10px;letter-spacing:1.2px;color:#d6cfa8;',
        'ONLINE · CONNECTING',
      );
    }
    add(
      'hit',
      'position:absolute;left:50%;top:50%;font-size:32px;transform:translate(-50%,-50%);color:#ffdca1;',
      '×',
    );
    add('health', 'position:absolute;left:28px;bottom:55px;font-size:31px;font-weight:700;');
    add(
      'healthbar',
      'position:absolute;left:28px;bottom:45px;height:3px;background:#b8c89a;width:160px;',
    );
    add(
      'ammo',
      'position:absolute;right:28px;bottom:50px;text-align:right;font-size:12px;letter-spacing:2px;',
      'FIELD BOW\n∞ ARROWS',
    );
    this.hud.ammo.style.whiteSpace = 'pre';
    add(
      'feed',
      'position:absolute;left:0;right:0;top:59%;text-align:center;color:#ffdaa0;font-weight:700;letter-spacing:1px;',
    );
    add(
      'help',
      'position:absolute;bottom:17px;left:28px;right:28px;font-size:10px;color:#d8dacb;letter-spacing:.7px;',
      'WASD MOVE     SHIFT SPRINT     SPACE JUMP     HOLD LMB DRAW / RELEASE FIRE     RMB AIM     R RESTART     M MUTE     ESC PAUSE',
    );
    add('damage', 'position:absolute;inset:0;box-shadow:inset 0 0 100px 30px #a02b22;opacity:0;');
    const modal = add(
      'modal',
      'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(440px,85%);background:rgba(22,27,23,.92);border:1px solid #727564;padding:32px;text-align:center;pointer-events:auto;box-shadow:0 20px 70px #0008;',
    );
    const title = document.createElement('div');
    title.style.cssText = 'font-size:27px;font-weight:800;letter-spacing:5px;margin-bottom:12px';
    title.textContent = 'TIMBER / ASH';
    modal.append(title);
    this.hud.title = title;
    this.hudValues['text:title'] = 'TIMBER / ASH';
    const description = document.createElement('div');
    description.style.cssText =
      'color:#bfc6b4;line-height:1.8;font-size:13px;white-space:pre-line;margin-bottom:24px';
    modal.append(description);
    this.hud.description = description;

    if (this.session) {
      const input = document.createElement('input');
      input.setAttribute('aria-label', 'Archer name');
      input.maxLength = 24;
      input.value = this.session.getName();
      input.style.cssText =
        'display:block;width:100%;margin:-6px 0 18px;padding:11px 12px;background:#111713;color:#ecece3;border:1px solid #727564;text-align:center;font:700 13px system-ui,sans-serif;letter-spacing:1px;outline:none';
      modal.append(input);
      this.hud.name = input;
    }

    const button = document.createElement('button');
    button.textContent = 'ENTER ARENA';
    button.style.cssText =
      'background:#bdc593;border:0;padding:13px 26px;color:#22291b;font-weight:800;letter-spacing:2px;cursor:pointer';

    button.onclick = () => {
      if (this.winner && !this.session) {
        this.restart();
      }

      this.enter();
    };

    modal.append(button);
    this.hud.button = button;
    this.hudValues['text:button'] = 'ENTER ARENA';

    if (this.session) {
      const solo = document.createElement('button');
      solo.textContent = 'PLAY SOLO';
      solo.style.cssText =
        'display:none;margin:14px auto 0;background:transparent;border:1px solid #9da283;padding:10px 20px;color:#d8dacb;font-weight:700;letter-spacing:2px;cursor:pointer';

      solo.onclick = () => {
        const url = new URL(location.href);
        url.searchParams.delete('online');
        url.searchParams.set('solo', '1');
        location.href = url.href;
      };

      modal.append(solo);
      this.hud.solo = solo;
    }

    (this.viewer.container ?? document.body).append(overlay);
    this.overlay = overlay;
    this.updateHud();
  }
  private updateHud(): void {
    if (!this.overlay) {
      return;
    }

    const rect = this.viewer.canvas.getBoundingClientRect();
    this.setHudStyle('overlay', 'left', `${rect.left}px`);
    this.setHudStyle('overlay', 'top', `${rect.top}px`);
    this.setHudStyle('overlay', 'width', `${rect.width}px`);
    this.setHudStyle('overlay', 'height', `${rect.height}px`);
    const snapshot = this.networkSnapshot;
    const isOnline = Boolean(this.session);
    const limit = isOnline ? (snapshot?.scoreLimit ?? 20) : this.requiredConfig.scoreLimit;
    this.setHudText('score', `${String(this.kills).padStart(2, '0')} / ${limit}  ELIMINATIONS`);
    if (isOnline) {
      const players = snapshot?.players ?? [];
      this.setHudText(
        'board',
        [...players]
          // The style guide explicitly permits `(a, b)` for numeric sorts.
          // eslint-disable-next-line id-length
          .sort((a, b) => a.slot - b.slot)
          .map(
            (player) =>
              `${player.local ? 'YOU' : player.name}    ${snapshot?.scores[player.id] ?? 0} K / ${player.deaths} D`,
          )
          .join('\n'),
      );
      const latency =
        snapshot?.latencyMs === null || snapshot?.latencyMs === undefined
          ? ''
          : ` · ${Math.round(snapshot.latencyMs)} MS RTT`;
      this.setHudText(
        'network',
        `ONLINE · ${(snapshot?.status ?? 'connecting').toUpperCase()} · ${players.length}/${BOW_ROOM_CAP} PLAYERS${latency} · ROUND ${snapshot?.round ?? 1} · FIRST TO ${limit}`,
      );
    } else {
      this.setHudText(
        'board',
        this.bots.map((bot) => `${bot.name}    ${bot.kills} K / ${bot.deaths} D`).join('\n'),
      );
    }
    this.setHudText('health', `${this.hp}  HP`);
    this.setHudStyle('healthbar', 'width', `${this.hp * 1.6}px`);
    this.setHudStyle('healthbar', 'background', this.hp < 35 ? '#c9604c' : '#b8c89a');
    this.setHudStyle('hit', 'opacity', String(this.hit));
    this.setHudStyle('damage', 'opacity', String(this.flash * 0.6));
    let feedText = '';

    if (this.hp <= 0) {
      feedText = `YOU FELL · RESPAWNING IN ${Math.max(1, Math.ceil(this.deadUntil - this.elapsed))}`;
    } else if (this.elapsed < this.messageUntil) {
      feedText = this.message;
    }

    this.setHudText('feed', feedText);

    if (!isOnline) {
      const show = (!this.active || Boolean(this.winner)) && !this.preview;
      this.setHudText(
        'sub',
        this.preview ? 'MODEL INSPECTION · R RETURN TO MATCH' : 'BOW DEATHMATCH · LOCAL BOT ARENA',
      );
      this.setHudStyle('modal', 'display', show ? 'block' : 'none');
      let title = 'TIMBER / ASH';
      let description = `${this.requiredConfig.botCount} hunters. First to ${this.requiredConfig.scoreLimit} eliminations.\nHold to draw. Release to fire. Lead moving targets.\nArrows drop with distance. Rocks stop arrows.\nHeadshots deal extra damage. Respawn is automatic.`;

      if (this.winner) {
        title = this.winner === 'YOU' ? 'VICTORY' : 'MATCH OVER';
        description = `${this.winner} reached ${this.requiredConfig.scoreLimit} eliminations.\nYour score: ${this.kills} kills / ${this.deaths} deaths`;
      }

      let buttonText = 'ENTER ARENA';

      if (this.winner) {
        buttonText = 'PLAY AGAIN';
      } else if (this.elapsed > 0) {
        buttonText = 'RESUME HUNT';
      }

      this.setHudText('title', title);
      this.setHudText('description', description);
      this.setHudText('button', buttonText);

      return;
    }

    const status = snapshot?.status ?? 'connecting';
    const isBlocked =
      status === 'full' ||
      status === 'reconnecting' ||
      status === 'disconnected' ||
      status === 'connecting';
    const show = !this.active || Boolean(this.winner) || isBlocked;
    this.setHudText('sub', 'BOW DEATHMATCH · ONLINE · NO BOTS');
    this.setHudStyle('modal', 'display', show ? 'block' : 'none');
    let title = 'TIMBER / ASH';

    if (status === 'full') {
      title = 'SERVER FULL';
    } else if (this.winner === 'YOU') {
      title = 'VICTORY';
    } else if (this.winner) {
      title = 'ROUND OVER';
    }

    let description = `${snapshot?.players.length ?? 0} archers online. First to ${limit} eliminations.\nNo bots online. Hits use the trusted-friends model.\nHeadshots deal extra damage. Respawn is automatic.`;

    if (status === 'full') {
      description = `The main room already has ${BOW_ROOM_CAP} archers.\nTry again later or continue in solo mode.`;
    } else if (status === 'reconnecting' || status === 'disconnected') {
      description =
        'Connection lost. Reconnecting with backoff.\nYou can continue immediately in solo mode.';
    } else if (status === 'connecting') {
      description = 'Connecting to the main room…';
    } else if (this.winner) {
      description = `${this.winner} reached ${limit} eliminations.\nThe next round begins in about 5 seconds.`;
    }

    this.setHudText('title', title);
    this.setHudText('description', description);
    const disabled = isBlocked || Boolean(this.winner);
    this.setHudDisabled('button', disabled);
    this.setHudStyle('button', 'opacity', disabled ? '.55' : '1');
    let buttonText = 'ENTER ARENA';

    if (this.winner) {
      buttonText = 'ROUND RESTARTS SOON';
    } else if (status === 'full') {
      buttonText = 'ROOM UNAVAILABLE';
    } else if (isBlocked) {
      buttonText = 'CONNECTING…';
    } else if (this.elapsed > 0) {
      buttonText = 'RESUME HUNT';
    }

    this.setHudText('button', buttonText);
    this.setHudStyle('name', 'display', this.winner || status === 'full' ? 'none' : 'block');
    this.setHudStyle('solo', 'display', isBlocked ? 'block' : 'none');
  }
}
