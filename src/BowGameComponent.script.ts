/** Adapts the bow runtime to Kite3D's component lifecycle and runtime-ownership contract. */
import { RuntimeObjectOwner, type GameValidationResult } from '@blitzdev/engine';
import {
  Group,
  Object3DComponent,
  literalStrings,
  type ComponentDefn,
  type ViewerEventMap,
} from 'threepipe';
import { createBowBootstrap, type BowBootstrapHost } from './BowBootstrap.js';
import { BowGameRuntime } from './BowGameRuntime.js';
import type { BowNetSession } from './BowNetSession.js';
import type { BowPerformance } from './BowPerformance.js';
import { buildGameWorld } from './GameWorld.js';

declare global {
  interface Window {
    __KITE_BOW_GAME__?: BowGameComponent;
    __KITE_BOW_SESSION__?: BowNetSession;
    __KITE_BOW_TELEMETRY__?: BowPerformance;
    viewer?: unknown;
  }
}

const DIFFICULTIES = ['easy', 'normal', 'hard'] as const;
type Difficulty = (typeof DIFFICULTIES)[number];

// Solo matches require at least one opponent.
const MIN_BOT_COUNT = 1;
// Six bots is the authored arena's supported local population.
const MAX_BOT_COUNT = 6;
// Three bots preserves the serialized scene's original default.
const DEFAULT_BOT_COUNT = 3;
// A positive score is required to complete a match.
const MIN_SCORE_LIMIT = 1;
// Fifty is the editor control's original practical upper bound.
const MAX_SCORE_LIMIT = 50;
// Ten eliminations preserves the serialized solo-match default.
const DEFAULT_SCORE_LIMIT = 10;

/** Owns one Play lifetime without placing generated objects below the authored source. */
export class BowGameComponent extends Object3DComponent {
  static ComponentType = 'BowGameComponent';
  static StateProperties: ComponentDefn['StateProperties'] = [
    {
      key: 'botCount',
      type: 'number',
      uiConfig: { bounds: [MIN_BOT_COUNT, MAX_BOT_COUNT], stepSize: 1 },
    },
    {
      key: 'scoreLimit',
      type: 'number',
      uiConfig: { bounds: [MIN_SCORE_LIMIT, MAX_SCORE_LIMIT], stepSize: 1 },
    },
    { key: 'difficulty', type: literalStrings(DIFFICULTIES) },
  ];

  botCount = DEFAULT_BOT_COUNT;
  scoreLimit = DEFAULT_SCORE_LIMIT;
  difficulty: Difficulty = 'normal';

  private runtime: BowGameRuntime | null = null;
  private runtimeRoot: Group | null = null;
  private runtimeOwner: RuntimeObjectOwner | null = null;
  private host: BowBootstrapHost | null = null;
  private rejectReady: ((reason: Error) => void) | null = null;
  private readiness: Promise<void> = Promise.resolve();
  private generation = 0;

  /**
   * Returns the current Play lifetime's asynchronous startup result.
   *
   * @returns A promise that resolves only after all runtime assets and systems are ready.
   */
  get ready(): Promise<void> {
    return this.readiness;
  }

  /** Creates the owned runtime root and begins asynchronous asset preload. */
  start(): void {
    const generation = ++this.generation;
    const host = createBowBootstrap(this.ctx.viewer);
    this.host = host;
    window.__KITE_BOW_GAME__ = this;
    this.readiness = new Promise<void>((resolve, reject) => {
      this.rejectReady = reject;
      this.startRuntime({ generation, host, resolve });
    });
  }

  private startRuntime(options: {
    generation: number;
    host: BowBootstrapHost;
    resolve: () => void;
  }): void {
    try {
      this.validateSettings();
      const builtWorld = buildGameWorld({
        botCount: this.botCount,
        scoreLimit: this.scoreLimit,
        difficulty: this.difficulty,
      });
      const runtimeRoot = new Group();
      runtimeRoot.name = 'K3D_BOW_RUNTIME';
      const runtimeOwner = new RuntimeObjectOwner(`bow-game:${this.uuid}`);
      runtimeOwner.attachRuntimeRoot(runtimeRoot, this.ctx.viewer.scene, this.object);
      runtimeRoot.add(builtWorld.arenaRoot);
      this.runtimeRoot = runtimeRoot;
      this.runtimeOwner = runtimeOwner;

      const runtime = new BowGameRuntime(this.ctx.viewer, {
        config: builtWorld.config,
        arenaRoot: builtWorld.arenaRoot,
        runtimeParent: runtimeRoot,
        authoredPreviewRoot: this.object,
        collisionTestEnabled: options.host.collisionTestEnabled,
        isPaused: () => !this.ctx.ecp.running,
        ownsArena: true,
        session: options.host.session,
        performanceStats: options.host.performanceStats,
      });
      this.runtime = runtime;
      void runtime.start().then(
        () => this.finishStart(runtime, options.generation, options.resolve),
        (error: unknown) => this.failStart(error, options.generation),
      );
    } catch (error: unknown) {
      this.failStart(error, options.generation);
    }
  }

  private finishStart(runtime: BowGameRuntime, generation: number, resolve: () => void): void {
    if (generation !== this.generation || this.runtime !== runtime) {
      runtime.stop();

      return;
    }

    this.rejectReady = null;
    resolve();
  }

  private failStart(error: unknown, generation: number): void {
    const reason = error instanceof Error ? error : new Error(String(error));
    console.error('[BowGameComponent] Failed to start', reason);
    if (generation === this.generation) {
      this.rejectReady?.(reason);
      this.rejectReady = null;
      this.cleanupRuntime();
    }
  }

  private validateSettings(): void {
    if (
      !Number.isInteger(this.botCount) ||
      this.botCount < MIN_BOT_COUNT ||
      this.botCount > MAX_BOT_COUNT
    ) {
      throw new Error('botCount must be an integer from 1 to 6');
    }

    if (
      !Number.isInteger(this.scoreLimit) ||
      this.scoreLimit < MIN_SCORE_LIMIT ||
      this.scoreLimit > MAX_SCORE_LIMIT
    ) {
      throw new Error('scoreLimit must be an integer from 1 to 50');
    }

    if (!DIFFICULTIES.includes(this.difficulty)) {
      throw new Error('difficulty must be easy, normal, or hard');
    }
  }

  /**
   * Advances the active runtime once per Threepipe frame.
   *
   * @param frame - Threepipe frame event containing delta and absolute time in seconds.
   * @param frame.deltaTime - Seconds elapsed since the previous frame.
   * @param frame.time - Absolute Threepipe frame time in seconds.
   * @returns Whether Threepipe should request another render.
   */
  update({ deltaTime, time }: ViewerEventMap['preFrame']): boolean {
    return this.runtime?.update(deltaTime, time) ?? false;
  }

  /** Stops runtime services and releases every Play-only object and browser resource. */
  stop(): void {
    this.generation++;
    this.rejectReady?.(new Error('Bow game stopped before startup completed'));
    this.rejectReady = null;
    this.cleanupRuntime();
  }

  private cleanupRuntime(): void {
    const runtime = this.runtime;
    const runtimeOwner = this.runtimeOwner;
    const host = this.host;
    this.runtime = null;
    this.runtimeRoot = null;
    this.runtimeOwner = null;
    this.host = null;

    try {
      runtime?.stop();
    } finally {
      runtimeOwner?.cleanup();
      host?.cleanup();
      if (window.__KITE_BOW_GAME__ === this) {
        delete window.__KITE_BOW_GAME__;
      }
    }
  }

  /**
   * Stops resources before delegating component destruction to Threepipe.
   *
   * @returns The base component's serialized destruction state.
   */
  destroy(): ReturnType<Object3DComponent['destroy']> {
    this.stop();

    return super.destroy();
  }

  /**
   * Registers teardown work owned by the post-start Kite hook.
   *
   * @param callback - Idempotent cleanup for validation, telemetry, stats, or diagnostics.
   */
  addHostCleanup(callback: () => void): void {
    this.host?.addCleanup(callback);
  }

  /** Removes the component preload marker after the post-start hook is ready. */
  removeLoading(): void {
    this.host?.removeLoading();
  }

  /**
   * Reports current gameplay mode without exposing transport implementation.
   *
   * @returns `online` for a configured session, otherwise `solo`.
   */
  getMode(): 'solo' | 'online' {
    return this.host?.mode ?? 'solo';
  }

  /**
   * Validates the live runtime relationships needed by Kite's Playable check.
   *
   * @returns A platform validation result with individual lifecycle checks.
   */
  validateForKite(): GameValidationResult {
    const checks = {
      ready: Boolean(this.runtime?.state.running),
      arena: Boolean(this.runtime?.world.getArenaRoot()),
      collision: Boolean(this.runtime?.world.collision),
      player: Boolean(this.runtime?.state.arm.parent),
      runtimeRoot: this.runtimeRoot?.parent === this.ctx.viewer.scene,
      worldRoot: this.runtime?.world.root.parent === this.runtimeRoot,
    };
    const hasFailedCheck = Object.values(checks).includes(false);

    return {
      status: hasFailedCheck ? 'fail' : 'pass',
      summary: hasFailedCheck
        ? 'Bow runtime did not establish every required Play relationship.'
        : 'Bow runtime and its owned scene root are ready.',
      checks,
    };
  }

  /**
   * Returns the current runtime snapshot, or null before start and after stop.
   *
   * @returns Serializable runtime state or null when inactive.
   */
  getState(): ReturnType<BowGameRuntime['getState']> | null {
    return this.runtime?.getState() ?? null;
  }

  /**
   * Applies the deterministic visual inspection controls used by browser tests.
   *
   * @param options - Camera and bow-pose inspection values.
   * @returns Current serializable runtime state.
   */
  inspect(options: Parameters<BowGameRuntime['inspect']>[0]): object {
    if (!this.runtime) {
      throw new Error('Bow game is not running');
    }

    return this.runtime.inspect(options);
  }

  /**
   * Exercises collision behavior when the explicit capability was enabled at startup.
   *
   * @param action - Movement and projectile controls for deterministic inspection.
   * @returns Collision and player state after the requested fixed steps.
   */
  collisionTest(action?: Parameters<BowGameRuntime['collisionTest']>[0]): object {
    if (!this.runtime) {
      throw new Error('Bow game is not running');
    }

    return this.runtime.collisionTest(action);
  }
}

export default BowGameComponent;
