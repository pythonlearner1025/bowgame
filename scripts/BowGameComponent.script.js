/**
 * Adapts the bow runtime to Threepipe's component lifecycle without implementing gameplay itself.
 */
import { Object3DComponent, literalStrings, } from 'threepipe';
import { buildBowArena } from './BowArena.js';
import { BowGameRuntime } from './BowGameRuntime.js';
const DIFFICULTIES = ['easy', 'normal', 'hard'];
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
/** Owns arena and runtime lifetime for one serialized Threepipe component. */
export class BowGameComponent extends Object3DComponent {
    static ComponentType = 'BowGameComponent';
    static StateProperties = [
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
    difficulty = 'normal';
    runtime = null;
    generation = 0;
    /** Validates component state, creates the runtime arena, and starts the game asynchronously. */
    start() {
        const generation = ++this.generation;
        const botCount = this.botCount;
        const scoreLimit = this.scoreLimit;
        const difficulty = this.difficulty;
        if (!Number.isInteger(botCount) || botCount < MIN_BOT_COUNT || botCount > MAX_BOT_COUNT) {
            throw new Error('botCount must be an integer from 1 to 6');
        }
        if (!Number.isInteger(scoreLimit) ||
            scoreLimit < MIN_SCORE_LIMIT ||
            scoreLimit > MAX_SCORE_LIMIT) {
            throw new Error('scoreLimit must be an integer from 1 to 50');
        }
        if (!DIFFICULTIES.includes(difficulty)) {
            throw new Error('difficulty must be easy, normal, or hard');
        }
        // The GLB intentionally stores this empty authored group plus component state.
        // The unchanged seeded arena is runtime-only because its instancing is lossy in GLB.
        const arena = buildBowArena();
        arena.group.name = 'K3D_BOW_RUNTIME_ARENA';
        this.object.add(arena.group);
        const config = {
            version: 1,
            kind: 'bow-deathmatch',
            botCount,
            scoreLimit,
            difficulty,
            obstacles: arena.obstacles,
            botSpawns: arena.botSpawns.map(({ x, y, z }) => ({ x, y, z })),
            playerSpawn: { x: arena.playerSpawn.x, y: arena.playerSpawn.y, z: arena.playerSpawn.z },
        };
        const runtime = new BowGameRuntime(this.ctx.viewer, {
            config,
            arenaRoot: arena.group,
            isPaused: () => !this.ctx.ecp.running,
            ownsArena: true,
            session: window.__KITE_BOW_SESSION__ ?? null,
            performanceStats: window.__KITE_BOW_TELEMETRY__ ?? null,
        });
        this.runtime = runtime;
        window.__KITE_BOW_GAME__ = this;
        void runtime
            .start()
            .then(() => {
            if (generation !== this.generation || this.runtime !== runtime) {
                runtime.stop();
            }
        })
            .catch((error) => {
            console.error('[BowGameComponent] Failed to start', error);
            if (this.runtime === runtime) {
                this.runtime = null;
            }
            runtime.stop();
        });
    }
    /**
     * Advances the active runtime once per Threepipe frame.
     *
     * @param frame - Threepipe frame event containing delta and absolute time in seconds.
     * @param frame.deltaTime - Seconds elapsed since the previous frame.
     * @param frame.time - Absolute Threepipe frame time in seconds.
     * @returns Whether Threepipe should request another render.
     */
    update({ deltaTime, time }) {
        return this.runtime?.update(deltaTime, time) ?? false;
    }
    /** Stops and releases the runtime owned by this component. */
    stop() {
        this.generation++;
        const runtime = this.runtime;
        this.runtime = null;
        runtime?.stop();
        if (window.__KITE_BOW_GAME__ === this) {
            delete window.__KITE_BOW_GAME__;
        }
    }
    /**
     * Stops runtime resources before delegating component destruction to Threepipe.
     *
     * @returns The base component's destruction result.
     */
    destroy() {
        this.stop();
        return super.destroy();
    }
    /**
     * Returns the current runtime snapshot, or null before start and after stop.
     *
     * @returns Serializable runtime state or null when inactive.
     */
    getState() {
        return this.runtime?.getState() ?? null;
    }
}
export default BowGameComponent;
