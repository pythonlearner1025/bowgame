/**
 * Owns session event translation and all outbound gameplay messages without rendering anything.
 * State messages leave at 20 Hz; positions use world meters and angles use radians.
 */
import { Vector3 } from 'threepipe';
import { shotDamage } from './BowPhysics.js';
/** Converts BowNetSession messages into game-state mutations and outbound commands. */
export class NetworkGlue {
    state;
    session;
    callbacks;
    unsubscribe = null;
    /**
     * Creates the protocol boundary for one optional online session.
     *
     * @param state - Mutable simulation state shared by all systems.
     * @param session - Online session, or null for unchanged solo play.
     * @param callbacks - State, combat, projectile, remote-player, and HUD side effects.
     */
    constructor(state, session, callbacks) {
        this.state = state;
        this.session = session;
        this.callbacks = callbacks;
    }
    /** Subscribes to session changes and opens the transport when online. */
    start() {
        if (!this.session) {
            return;
        }
        this.unsubscribe = this.session.onChange((message, snapshot) => this.onMessage(message, snapshot));
        this.session.start();
    }
    /** Unsubscribes, closes the session, and clears transient protocol state. */
    stop() {
        this.unsubscribe?.();
        this.unsubscribe = null;
        this.session?.stop();
        this.state.networkSnapshot = null;
        this.state.receivedHits.clear();
    }
    /**
     * Applies one parsed server event and its authoritative session snapshot.
     * @param message - Parsed server event, or null for a snapshot-only session change.
     * @param snapshot - Current detached session state after applying the event.
     */
    onMessage(message, snapshot) {
        const previousId = this.state.networkSnapshot?.playerId;
        this.state.networkSnapshot = snapshot;
        this.callbacks.syncRemotePlayers(snapshot);
        if (snapshot.playerId) {
            this.state.kills = snapshot.scores[snapshot.playerId] ?? 0;
        }
        const local = snapshot.players.find((player) => player.local);
        if (local) {
            this.state.deaths = local.deaths;
        }
        if (message?.type === 'welcome' && snapshot.playerId !== previousId) {
            this.applyWelcome(snapshot);
        }
        if (message?.type === 'shot' && message.playerId !== snapshot.playerId) {
            this.callbacks.spawnArrow(new Vector3(message.origin.x, message.origin.y, message.origin.z), new Vector3(message.velocity.x, message.velocity.y, message.velocity.z), {
                owner: 0,
                arrowId: message.arrowId,
                isVisualOnly: true,
                damage: shotDamage(1),
                sourcePlayerId: message.playerId,
            });
        }
        if (message?.type === 'hit' && message.targetId === snapshot.playerId) {
            this.callbacks.applyNetworkHit(message);
        }
        if (message?.type === 'death') {
            this.applyDeath(message, snapshot);
        }
        if (message?.type === 'round_end') {
            this.applyRoundEnd(message, snapshot);
        }
        if (message?.type === 'round_reset') {
            this.callbacks.resetOnlineRound();
        }
        if (message?.type === 'full') {
            this.state.message = 'Server full';
            this.state.messageUntil = Infinity;
        }
        this.callbacks.updateHud();
    }
    applyWelcome(snapshot) {
        const own = snapshot.players.find((player) => player.local);
        if (own) {
            this.state.player.copy(this.callbacks.getSlotSpawn(own.slot));
            this.state.velocity.set(0, 0, 0);
            this.state.grounded = false;
            this.state.lastWorldImpact = null;
            this.state.hp = 100;
        }
    }
    applyDeath(message, snapshot) {
        this.callbacks.addDeath(this.getPlayerName(message.killerId, snapshot), this.getPlayerName(message.playerId, snapshot));
        this.callbacks.setRemoteDead(message.playerId);
    }
    applyRoundEnd(message, snapshot) {
        const winner = snapshot.players.find((player) => player.id === message.winnerId);
        this.state.winner = message.winnerId === snapshot.playerId ? 'YOU' : (winner?.name ?? 'ARCHER');
        this.state.message = `${this.state.winner} reached ${snapshot.scoreLimit} eliminations`;
        this.state.messageUntil = Infinity;
    }
    getPlayerName(playerId, snapshot) {
        if (playerId === snapshot.playerId) {
            return 'YOU';
        }
        return snapshot.players.find((player) => player.id === playerId)?.name ?? 'ARCHER';
    }
    /**
     * Sends the latest local transform and animation at the unchanged 20 Hz cadence.
     * @param dt - Fixed simulation duration in seconds.
     */
    step(dt) {
        if (!this.session) {
            return;
        }
        this.state.networkAccumulator += dt;
        if (this.state.networkAccumulator < 0.05) {
            return;
        }
        this.state.networkAccumulator %= 0.05;
        const animation = this.getAnimation();
        this.session.sendState({
            seq: ++this.state.networkSeq,
            pos: { x: this.state.player.x, y: this.state.player.y, z: this.state.player.z },
            yaw: this.state.yaw,
            pitch: this.state.pitch,
            draw: this.state.charge,
            anim: animation,
        });
    }
    getAnimation() {
        const isMoving = this.state.keys.has('KeyW') ||
            this.state.keys.has('KeyA') ||
            this.state.keys.has('KeyS') ||
            this.state.keys.has('KeyD') ||
            this.state.keys.has('ArrowUp') ||
            this.state.keys.has('ArrowDown') ||
            this.state.keys.has('ArrowLeft') ||
            this.state.keys.has('ArrowRight');
        if (this.state.hp <= 0) {
            return 'dead';
        }
        if (this.state.releaseTime >= 0) {
            return 'release';
        }
        if (this.state.drawing) {
            return 'draw';
        }
        return isMoving ? 'walk' : 'ready';
    }
    /**
     * Sends one local arrow launch through the session.
     * @param arrowId - Locally unique projectile identifier.
     * @param position - Arrowhead origin in world meters.
     * @param velocity - Arrow velocity in meters per second.
     */
    sendShot(arrowId, position, velocity) {
        this.session?.sendShot(arrowId, { x: position.x, y: position.y, z: position.z }, { x: velocity.x, y: velocity.y, z: velocity.z });
    }
    /**
     * Sends one local remote-player hit through the session.
     * @param targetId - Session identifier of the remote victim.
     * @param arrowId - Locally unique projectile identifier.
     * @param damage - Integer health points reported to the victim.
     * @param isHead - Whether the swept arrow hit the head volume.
     */
    sendHit(targetId, arrowId, damage, isHead) {
        this.session?.sendHit(targetId, arrowId, damage, isHead);
    }
    /**
     * Reports one local death to the victim-authoritative session.
     * @param killerId - Session identifier credited for the local death.
     */
    sendDeath(killerId) {
        this.session?.sendDeath(killerId);
    }
    /**
     * Applies a chosen display name to the active online session.
     * @param name - Sanitized display name selected by the player.
     */
    setName(name) {
        this.session?.setName(name);
    }
    /**
     * Returns the session's current name, or null in solo mode.
     *
     * @returns Current session display name, or null.
     */
    getName() {
        return this.session?.getName() ?? null;
    }
    /**
     * Returns whether the online session is currently connected.
     *
     * @returns True for solo mode or a connected online session.
     */
    isConnected() {
        return !this.session || this.state.networkSnapshot?.status === 'connected';
    }
    /**
     * Returns whether a live online session exists for this runtime.
     *
     * @returns Whether an online session was supplied.
     */
    isOnline() {
        return Boolean(this.session);
    }
}
