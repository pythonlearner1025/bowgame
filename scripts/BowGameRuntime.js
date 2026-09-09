import { ArrowSystem } from './ArrowSystem.js';
import { BotSystem } from './BotSystem.js';
import { BowController } from './BowController.js';
import { CombatRules } from './CombatRules.js';
import { EntryOverlay } from './EntryOverlay.js';
import { GameState, } from './GameState.js';
import { GameWorld } from './GameWorld.js';
import { Hud } from './Hud.js';
import { NetworkGlue } from './NetworkGlue.js';
import { PlayerController } from './PlayerController.js';
import { RemotePlayers } from './RemotePlayers.js';
import { preloadHumanAsset } from './BowHumanAsset.js';
import { sampleReferenceAction } from './BowReferenceClip.js';
/** Coordinates the stable public game surface while delegating each owner responsibility. */
export class BowGameRuntime {
    viewer;
    state;
    world;
    arrows;
    bots;
    remotePlayers;
    combat;
    network;
    bow;
    entry;
    hud;
    playerController;
    lifecycle = 0;
    isPaused;
    performanceStats;
    /**
     * Creates an inert runtime and wires its systems without allocating play-mode resources.
     *
     * @param viewer - Threepipe viewer that owns the active scene and camera.
     * @param options - Optional configuration, injected services, and arena ownership.
     */
    constructor(viewer, options = {}) {
        this.viewer = viewer;
        this.state = new GameState(options.config);
        this.isPaused = options.isPaused ?? (() => false);
        this.performanceStats = options.performanceStats ?? null;
        this.world = new GameWorld(viewer, {
            arenaRoot: options.arenaRoot,
            ownsArena: options.ownsArena ?? false,
        });
        this.arrows = new ArrowSystem(this.state, this.world, () => this.requiredConfig, {
            getAudio: () => this.state.sounds,
            isOnline: () => this.network.isOnline(),
            getRemoteCandidates: (excludedId) => this.remotePlayers.getHitCandidates(excludedId),
            applyDamage: (victim, damage, owner, isHead) => this.combat.damage(victim, damage, owner, isHead),
            sendShot: (arrowId, position, velocity) => this.network.sendShot(arrowId, position, velocity),
            sendHit: (targetId, arrowId, damage, isHead) => this.network.sendHit(targetId, arrowId, damage, isHead),
        });
        this.bots = new BotSystem(this.state, this.world, () => this.requiredConfig, {
            fire: (position, direction, owner, charge) => this.arrows.fire(position, direction, owner, charge),
        });
        this.remotePlayers = new RemotePlayers(this.state, this.world, this.bots, (slot) => this.world.getSlotSpawn(this.requiredConfig, slot));
        this.combat = new CombatRules(this.state, () => this.requiredConfig, () => Boolean(options.session), {
            getAudio: () => this.state.sounds,
            getSlotSpawn: (slot) => this.world.getSlotSpawn(this.requiredConfig, slot),
            spawnBot: (bot, index) => this.bots.spawn(bot, index),
            clearArrows: () => this.arrows.clear(),
            resetRemotePlayers: () => this.remotePlayers.resetRound(),
            sendDeath: (killerId) => this.network.sendDeath(killerId),
            updateCamera: () => this.playerController.updateCamera(),
        });
        this.network = new NetworkGlue(this.state, options.session ?? null, {
            getSlotSpawn: (slot) => this.world.getSlotSpawn(this.requiredConfig, slot),
            syncRemotePlayers: (snapshot) => this.remotePlayers.sync(snapshot),
            spawnArrow: (position, velocity, spawnOptions) => this.arrows.spawn(position, velocity, spawnOptions),
            applyNetworkHit: (message) => this.combat.applyNetworkHit(message),
            addDeath: (killer, victim) => this.combat.addDeath(killer, victim),
            setRemoteDead: (playerId) => this.remotePlayers.setDead(playerId),
            resetOnlineRound: () => this.combat.resetOnlineRound(),
            updateHud: () => this.hud.update(),
        });
        this.bow = new BowController({
            viewer,
            state: this.state,
            world: this.world,
            arrows: this.arrows,
            callbacks: {
                updateCamera: () => this.playerController.updateCamera(),
                getAudio: () => this.state.sounds,
            },
        });
        this.entry = new EntryOverlay(viewer, this.state, () => this.requiredConfig, {
            isOnline: () => this.network.isOnline(),
            isConnected: () => this.network.isConnected(),
            getNetworkName: () => this.network.getName(),
            setNetworkName: (name) => this.network.setName(name),
            restart: () => this.combat.restart(),
        });
        this.hud = new Hud(viewer, this.state, () => this.requiredConfig, this.entry);
        this.playerController = new PlayerController({
            viewer,
            state: this.state,
            world: this.world,
            bow: this.bow,
            bots: this.bots,
            getConfig: () => this.requiredConfig,
            callbacks: {
                enter: () => this.entry.enter(),
                restart: () => this.combat.restart(),
                stepRespawn: () => this.combat.stepRespawn(),
                getAudio: () => this.state.sounds,
                isOnline: () => this.network.isOnline(),
            },
        });
    }
    get requiredConfig() {
        if (!this.state.config) {
            throw new Error('Bow game runtime is not configured');
        }
        return this.state.config;
    }
    /**
     * Returns whether a playable game configuration was supplied.
     *
     * @returns Whether start can create an active match.
     */
    isConfigured() {
        return Boolean(this.state.config);
    }
    /**
     * Creates gameplay resources, installs input listeners, and enters the initial round.
     *
     * @returns Serializable state after startup completes or is superseded.
     */
    async start() {
        if (this.state.running) {
            this.stop();
        }
        const lifecycle = ++this.lifecycle;
        if (!this.state.config) {
            return this.getState();
        }
        await preloadHumanAsset();
        if (lifecycle !== this.lifecycle) {
            return this.getState();
        }
        this.world.start(this.state.config);
        this.bots.start(this.network.isOnline());
        this.bow.start();
        this.state.running = true;
        this.playerController.start();
        this.combat.restart();
        this.hud.start();
        this.network.start();
        this.performanceStats?.attachViewer(this.viewer);
        return this.getState();
    }
    /**
     * Removes all runtime resources and restores the viewer state captured by start.
     *
     * @returns Serializable inactive state after teardown.
     */
    stop() {
        this.lifecycle++;
        this.network.stop();
        this.remotePlayers.clear();
        this.performanceStats?.detachViewer();
        this.playerController.stop();
        this.state.preview = null;
        this.state.running = false;
        this.hud.stop();
        this.world.stop();
        this.state.arrows = [];
        this.state.bots = [];
        this.state.sounds?.dispose();
        this.state.sounds = null;
        return this.getState();
    }
    /**
     * Returns the serializable snapshot consumed by tests, diagnostics, and the host component.
     *
     * @returns A detached runtime snapshot with no live Three.js objects.
     */
    getState() {
        const state = this.state;
        return {
            name: state.playerName || this.network.getName() || null,
            collision: this.world.collision?.stats() ?? null,
            audio: state.sounds?.getState() ?? null,
            renderBatch: this.world.sceneBatch
                ? {
                    originalMeshes: this.world.sceneBatch.originalMeshes,
                    batches: this.world.sceneBatch.batches,
                }
                : null,
            performance: this.performanceStats?.summary() ?? null,
            preview: state.preview,
            animation: { phase: state.posePhase, releaseSeconds: Number(state.releaseTime.toFixed(3)) },
            kind: 'bow-deathmatch',
            mode: this.network.isOnline() ? 'online' : 'solo',
            configured: this.isConfigured(),
            active: state.running,
            paused: !state.active || this.isPaused(),
            health: state.hp,
            kills: state.kills,
            deaths: state.deaths,
            scoreLimit: this.network.isOnline()
                ? (state.networkSnapshot?.scoreLimit ?? 20)
                : (state.config?.scoreLimit ?? 10),
            winner: state.winner,
            draw: Number(state.charge.toFixed(3)),
            arrowsInFlight: state.arrows.filter((arrow) => !arrow.stuck).length,
            elapsed: Number(state.elapsed.toFixed(2)),
            player: {
                id: state.networkSnapshot?.playerId ?? null,
                position: { x: state.player.x, y: state.player.y, z: state.player.z },
                yaw: state.yaw,
                pitch: state.pitch,
                alive: state.hp > 0,
            },
            bots: state.bots.map((bot) => ({
                name: bot.name,
                health: bot.hp,
                kills: bot.kills,
                deaths: bot.deaths,
                alive: bot.hp > 0,
                position: { x: bot.mesh.position.x, y: bot.mesh.position.y, z: bot.mesh.position.z },
                drawing: bot.draw > 0,
            })),
            remotePlayers: [...state.remotePlayers.values()].map((player) => ({
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
            network: state.networkSnapshot,
            controls: 'Click viewport • WASD move • mouse aim • hold/release LMB shoot • RMB aim • Shift sprint • Space jump • R restart • M mute • Esc pause',
        };
    }
    /**
     * Applies deterministic visual inspection controls used by screenshots and regression tests.
     * @param params - Requested camera, draw, release, reference, and flight preview values.
     * @returns Current serializable runtime state after applying the preview.
     */
    inspect(params) {
        if (!this.state.running) {
            throw new Error('Start bow game play mode before inspecting it');
        }
        if (params.resume) {
            this.combat.restart();
            return this.getState();
        }
        const view = params.view ?? 'first-person';
        const draw = params.draw ?? 0;
        const release = params.release ?? -1;
        const orbit = params.orbit ?? 0;
        this.validateInspection(params, { view, draw, release, orbit });
        if (this.state.preview?.flightSeconds !== undefined || params.flightSeconds !== undefined) {
            this.combat.restart();
        }
        this.state.active = false;
        this.state.keys.clear();
        this.state.drawing = false;
        this.state.preview = { ...params, view, draw, release, orbit };
        this.applyFlightInspection(params.flightSeconds);
        this.playerController.updateCamera();
        this.hud.update();
        this.viewer.setDirty();
        return this.getState();
    }
    validateInspection(params, values) {
        const { view, draw, release, orbit } = values;
        const referenceTime = params.referenceTime;
        if (!['first-person', 'character'].includes(view) ||
            !Number.isFinite(draw) ||
            draw < 0 ||
            draw > 1 ||
            !Number.isFinite(release) ||
            release < -1 ||
            release > 2 ||
            !Number.isFinite(orbit) ||
            Math.abs(orbit) > 180) {
            throw new Error('Invalid bow inspection view, draw, release or orbit');
        }
        if (referenceTime !== undefined &&
            (!Number.isFinite(referenceTime) || referenceTime < 0 || referenceTime > 10)) {
            throw new Error('referenceTime must be within the studied first ten seconds');
        }
        if (params.aim !== undefined && typeof params.aim !== 'boolean') {
            throw new Error('aim must be boolean');
        }
        if (params.flightSeconds !== undefined &&
            (!Number.isFinite(params.flightSeconds) ||
                params.flightSeconds < 0 ||
                params.flightSeconds > 1)) {
            throw new Error('flightSeconds must be within zero and one second');
        }
        if (params.flightSide !== undefined && typeof params.flightSide !== 'boolean') {
            throw new Error('flightSide must be boolean');
        }
    }
    applyFlightInspection(flightSeconds) {
        if (flightSeconds === undefined) {
            return;
        }
        if (this.state.preview) {
            this.state.preview.draw = 1;
            this.state.preview.aim = true;
        }
        this.bow.firePlayer(sampleReferenceAction(1, -1, 1), 1);
        for (let remaining = flightSeconds; remaining > 1e-10;) {
            const dt = Math.min(1 / 120, remaining);
            this.state.elapsed += dt;
            this.arrows.step(dt);
            remaining -= dt;
        }
        if (this.state.preview) {
            this.state.preview.release = flightSeconds;
        }
    }
    /**
     * Exercises the real collision fixed step only when an explicit query parameter enables it.
     * @param action - Optional position, yaw, step count, synthetic shot, and resume controls.
     * @returns Collision distances, player state, spawn validity, and BVH statistics.
     */
    collisionTest(action = {}) {
        const result = this.world.inspectCollision({
            state: this.state,
            action,
            step: (dt) => this.step(dt),
            fireArrow: (position, velocity, isVisualOnly) => this.arrows.spawn(position, velocity, { owner: -1, isVisualOnly }),
            getSlotSpawn: (slot) => this.world.getSlotSpawn(this.requiredConfig, slot),
        });
        this.playerController.updateCamera();
        return result;
    }
    /**
     * Advances simulation, animation, networking, telemetry, and HUD state for one viewer frame.
     * @param deltaTime - Browser frame delta in milliseconds.
     * @param time - Current Performance timeline timestamp in milliseconds.
     * @returns Whether the runtime remains active and needs rendering.
     */
    update(deltaTime, time = performance.now()) {
        if (!this.state.running) {
            return false;
        }
        const start = performance.now();
        const frameMs = Math.max(0, deltaTime);
        const dt = Math.min(frameMs / 1000, 0.08);
        const isActive = this.state.active && !this.isPaused() && !this.state.winner;
        if (isActive && !this.state.testClockPaused) {
            this.state.accumulator += dt;
            while (this.state.accumulator >= 1 / 120) {
                this.step(1 / 120);
                this.state.accumulator -= 1 / 120;
            }
        }
        this.bots.updatePoses();
        this.remotePlayers.updatePoses();
        this.playerController.updateCamera();
        this.updatePresentation(time, frameMs, start, isActive);
        return true;
    }
    /*
     * Fixed-step order is behavior: later systems observe every earlier mutation in this list.
     * 1. Advance the simulation clock.
     * 2. Advance bow aim, release, cancel, cooldown, queued draw, and recoil transitions.
     * 3. Fade combat hit and damage feedback.
     * 4. Resolve local respawn or camera-relative player movement and collision.
     * 5. Increase bow charge after movement.
     * 6. Advance solo bots in stable array order.
     * 7. Interpolate remote players in stable map order.
     * 8. Step arrows, world sweeps, player-volume sweeps, impacts, and trails.
     * 9. Emit the latest online state at 20 Hz.
     */
    step(dt) {
        this.state.elapsed += dt;
        this.bow.stepTransitions(dt);
        this.combat.stepFeedback(dt);
        this.playerController.step(dt);
        this.bow.stepCharge(dt);
        this.bots.step(dt);
        this.remotePlayers.step(dt);
        this.arrows.step(dt);
        this.network.step(dt);
    }
    updatePresentation(time, frameMs, start, isActive) {
        if (time - this.state.lastHudUpdate > 33) {
            this.hud.update();
            this.state.lastHudUpdate = time;
            this.bow.updateDrawAudio(isActive);
            for (let i = 0; i < this.state.bots.length; i++) {
                const bot = this.state.bots[i];
                this.state.sounds?.draw(i, isActive && bot.hp > 0 ? bot.draw : 0, bot.mesh.position);
            }
        }
        this.performanceStats?.record(time, frameMs, performance.now() - start, isActive);
    }
    /** Enters play through the same name, connection, pointer-lock, and audio flow as the UI. */
    enter() {
        this.entry.enter();
    }
    /**
     * Applies a solo hit through the combat owner for browser regression hooks.
     * @param victim - Negative one for the local player, or a solo bot index.
     * @param damage - Integer health points removed by the hit.
     * @param owner - Negative one for the local player, or a solo bot index.
     * @param isHead - Whether the swept arrow hit the head volume.
     */
    damage(victim, damage, owner, isHead) {
        this.combat.damage(victim, damage, owner, isHead);
    }
    /**
     * Adds a death-feed row through the combat owner for browser regression hooks.
     * @param killer - Display name shown on the left side of the notice.
     * @param victim - Display name shown on the right side of the notice.
     */
    addDeath(killer, victim) {
        this.combat.addDeath(killer, victim);
    }
    /** Forces an idempotent HUD refresh for browser mutation regression hooks. */
    updateHud() {
        this.hud.update();
    }
}
