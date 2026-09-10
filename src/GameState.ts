/**
 * Owns mutable bow simulation data without owning input, rendering, networking, or game rules.
 * Positions and distances use meters in a Y-up world, rotations use radians, and time uses seconds.
 */
import { Group, Quaternion, Vector3, type Object3D, type TCameraControlsMode } from 'threepipe';
import type { ArrowTrailHandle } from './BowArrowTrail.js';
import type { BowAudio } from './BowAudio.js';
import type { ArmRig, HumanRig } from './BowVisuals.js';
import type { BowNetSession, NetSnapshot } from './BowNetSession.js';
import type { BowPerformance } from './BowPerformance.js';
import type { Cover } from './BowPhysics.js';
import type { PlayerAnim } from './BowProtocol.js';
import type { ReferencePose } from './BowReferenceClip.js';

/** Serialized match settings and authored arena spawn data. */
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

/** Deterministic visual inspection settings used by screenshots and regression tests. */
export interface InspectOptions {
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

/** Collision test controls enabled only by the explicit browser query parameter. */
export interface CollisionTestAction {
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

/** Runtime pose values shared by bots and remote player avatars. */
export interface BotPoseOptions {
  draw: number;
  walk?: number;
  isRelaxed?: boolean;
  release?: number;
}

/** Mutable state for one solo bot, including its rendered rig. */
export interface BotState {
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

/** Mutable interpolation and avatar state for one remote player. */
export interface RemotePlayerState extends BotState {
  id: string;
  slot: number;
  seq: number;
  target: Vector3;
  targetYaw: number;
  targetPitch: number;
  targetDraw: number;
  anim: PlayerAnim;
}

/** Mutable ballistic and rendering state for one local or relayed arrow. */
export interface ArrowState {
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

/** One temporary death-feed row with its simulation-time expiry. */
export interface DeathFeedEntry {
  killer: string;
  victim: string;
  expiresAtSeconds: number;
}

/** One normalized leaderboard row prepared for HUD sorting. */
export interface LeaderboardEntry {
  name: string;
  kills: number;
  isLocal: boolean;
}

/** Viewer camera values restored when the runtime stops. */
export interface CameraRestoreState {
  position: Vector3;
  quaternion: Quaternion;
  target?: Vector3;
  fov?: number;
  controlsMode?: TCameraControlsMode;
}

/** Scene objects hidden during play and restored during teardown. */
export interface HiddenObjectState {
  object: Object3D;
  visible: boolean;
}

/** Holds every mutable value advanced by the bow simulation and its presentation. */
export class GameState {
  running = false;
  grounded = false;
  coyoteSecondsRemaining = 0;
  testClockPaused = false;
  lastWorldImpact: Vector3 | null = null;
  preview: InspectOptions | null = null;
  bots: BotState[] = [];
  arrows: ArrowState[] = [];
  remotePlayers = new Map<string, RemotePlayerState>();
  player = new Vector3();
  velocity = new Vector3();
  hp = 100;
  kills = 0;
  deaths = 0;
  deadUntil = 0;
  elapsed = 0;
  winner = '';
  yaw = 0;
  pitch = 0;
  keys = new Set<string>();
  drawing = false;
  charge = 0;
  recoil = 0;
  releaseTime = -1;
  releasedCharge = 0;
  posePhase = 'ready';
  cooldown = 0;
  aiming = false;
  aimBlend = 0;
  queuedDraw = false;
  releaseFrom: ReferencePose | null = null;
  cancelFrom: ReferencePose | null = null;
  cancelTime = -1;
  accumulator = 0;
  flash = 0;
  hit = 0;
  message = '';
  messageUntil = 0;
  active = false;
  hadPointerLock = false;
  playerName = '';
  deathFeed: DeathFeedEntry[] = [];
  networkSnapshot: NetSnapshot | null = null;
  networkAccumulator = 0;
  networkSeq = 0;
  arrowSeq = 0;
  receivedHits = new Set<string>();
  lastHudUpdate = -1;
  bow = new Group();
  heldArrow = new Group();
  arm = new Group();
  hand = new Group();
  leftArm?: ArmRig;
  rightArm?: ArmRig;
  sounds: BowAudio | null = null;

  /**
   * Creates state around optional serialized match settings.
   *
   * @param config - Serialized match settings, or undefined for an inert runtime.
   */
  constructor(public config?: BowGameConfig) {}

  /** Clears transient round values while retaining allocated render objects and lifetime counters. */
  resetRoundValues(): void {
    this.deathFeed = [];
    this.hp = 100;
    this.deadUntil = 0;
    this.winner = '';
    this.velocity.set(0, 0, 0);
    this.grounded = false;
    this.coyoteSecondsRemaining = 0;
    this.lastWorldImpact = null;
    this.drawing = false;
    this.charge = 0;
    this.cooldown = 0;
    this.releaseTime = -1;
    this.message = '';
    this.messageUntil = 0;
  }
}
