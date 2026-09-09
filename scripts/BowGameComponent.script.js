import { Object3DComponent, literalStrings } from 'threepipe';
import { buildBowArena } from './BowArena.js';
import { BowGameRuntime } from './BowGameRuntime.js';
const DIFFICULTIES = ['easy', 'normal', 'hard'];
/** Project-level lifecycle adapter for the unchanged Timber / Ash simulation. */
export class BowGameComponent extends Object3DComponent {
    static ComponentType = 'BowGameComponent';
    static StateProperties = [
        { key: 'botCount', type: 'number', uiConfig: { bounds: [1, 6], stepSize: 1 } },
        { key: 'scoreLimit', type: 'number', uiConfig: { bounds: [1, 50], stepSize: 1 } },
        { key: 'difficulty', type: literalStrings(DIFFICULTIES) },
    ];
    botCount = 3;
    scoreLimit = 10;
    difficulty = 'normal';
    runtime = null;
    generation = 0;
    start() {
        const generation = ++this.generation;
        const count = this.botCount, limit = this.scoreLimit, difficulty = this.difficulty;
        if (!Number.isInteger(count) || count < 1 || count > 6)
            throw new Error('botCount must be an integer from 1 to 6');
        if (!Number.isInteger(limit) || limit < 1 || limit > 50)
            throw new Error('scoreLimit must be an integer from 1 to 50');
        if (!DIFFICULTIES.includes(difficulty))
            throw new Error('difficulty must be easy, normal, or hard');
        // The GLB intentionally stores this empty authored group plus component state.
        // The unchanged seeded arena is runtime-only because its instancing is lossy in GLB.
        const arena = buildBowArena();
        arena.group.name = 'K3D_BOW_RUNTIME_ARENA';
        this.object.add(arena.group);
        const config = {
            version: 1,
            kind: 'bow-deathmatch',
            botCount: count,
            scoreLimit: limit,
            difficulty,
            obstacles: arena.obstacles,
            botSpawns: arena.botSpawns.map(({ x, y, z }) => ({ x, y, z })),
            playerSpawn: { x: arena.playerSpawn.x, y: arena.playerSpawn.y, z: arena.playerSpawn.z },
        };
        const runtime = new BowGameRuntime(this.ctx.viewer, config, arena.group, () => !this.ctx.ecp.running, true, window.__KITE_BOW_SESSION__ ?? null);
        this.runtime = runtime;
        window.__KITE_BOW_GAME__ = this;
        void runtime.start().then(() => {
            if (generation !== this.generation || this.runtime !== runtime)
                runtime.stop();
        }).catch(error => {
            console.error('[BowGameComponent] Failed to start', error);
            if (this.runtime === runtime)
                this.runtime = null;
            runtime.stop();
        });
    }
    update({ deltaTime, time }) {
        return this.runtime?.update(deltaTime, time) ?? false;
    }
    stop() {
        this.generation++;
        const runtime = this.runtime;
        this.runtime = null;
        runtime?.stop();
        if (window.__KITE_BOW_GAME__ === this)
            delete window.__KITE_BOW_GAME__;
    }
    destroy() {
        this.stop();
        return super.destroy();
    }
    getState() { return this.runtime?.getState() ?? null; }
}
export default BowGameComponent;
