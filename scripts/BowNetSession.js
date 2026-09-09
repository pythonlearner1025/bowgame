/**
 * Owns multiplayer connection policy and the client-side room snapshot.
 * It does not render players, simulate combat, or implement WebSocket details.
 */
import { BOW_PROTOCOL_VERSION, BOW_SCORE_LIMIT, cleanPlayerName, parseServerMessage, } from './BowProtocol.js';
// Heartbeats measure latency without producing noticeable room traffic.
const HEARTBEAT_INTERVAL_MS = 20_000;
// The first reconnect waits roughly half a second before jitter is applied.
const INITIAL_RECONNECT_DELAY_MS = 500;
// Backoff stops growing at thirty seconds so a recovered room is eventually rejoined.
const MAX_RECONNECT_DELAY_MS = 30_000;
// Jitter from 0.75x to 1.25x prevents clients from reconnecting in lockstep.
const MIN_RECONNECT_JITTER = 0.75;
const RECONNECT_JITTER_RANGE = 0.5;
/** Maintains room state and reconnects a backend-neutral transport when needed. */
export class BowNetSession {
    transport;
    name;
    telemetry;
    status = 'disconnected';
    playerId = null;
    players = new Map();
    scores = {};
    scoreLimit = BOW_SCORE_LIMIT;
    round = BOW_PROTOCOL_VERSION;
    winnerId = null;
    latencyMs = null;
    listeners = new Set();
    removeTransportListener = null;
    reconnectTimer = null;
    heartbeatTimer = null;
    reconnectAttempt = 0;
    isStopped = true;
    /**
     * Creates a stopped session around an existing transport.
     *
     * @param transport - Connection implementation used to exchange protocol messages.
     * @param name - Initial local display name.
     * @param telemetry - Optional sink for reconnect, latency, and remote-state measurements.
     */
    constructor(transport, name, telemetry = null) {
        this.transport = transport;
        this.name = name;
        this.telemetry = telemetry;
        this.name = cleanPlayerName(name);
    }
    /**
     * Starts transport observation and the initial connection attempt.
     *
     * @returns Nothing.
     * Registers a transport listener and may open a network connection as side effects.
     */
    start() {
        if (!this.isStopped) {
            return;
        }
        this.isStopped = false;
        this.removeTransportListener = this.transport.onMessage(this.onTransport);
        this.tryConnect(false);
    }
    /**
     * Stops timers, observation, and the active transport connection.
     *
     * @returns Nothing.
     * Cancels pending browser timers and closes the transport as side effects.
     */
    stop() {
        this.isStopped = true;
        if (this.reconnectTimer !== null) {
            window.clearTimeout(this.reconnectTimer);
        }
        if (this.heartbeatTimer !== null) {
            window.clearInterval(this.heartbeatTimer);
        }
        this.reconnectTimer = null;
        this.heartbeatTimer = null;
        this.removeTransportListener?.();
        this.removeTransportListener = null;
        this.transport.close();
        this.setStatus('disconnected');
    }
    /**
     * Observes messages and state snapshots, including the current snapshot immediately.
     *
     * @param listener - Callback invoked synchronously when session state changes.
     * @returns A function that removes the callback.
     */
    onChange(listener) {
        this.listeners.add(listener);
        listener(null, this.snapshot());
        return () => this.listeners.delete(listener);
    }
    /**
     * Reads the sanitized local display name.
     *
     * @returns The current local display name.
     */
    getName() {
        return this.name;
    }
    /**
     * Copies the current session state so callers cannot mutate internal records.
     *
     * @returns A detached snapshot of connection, roster, score, and latency state.
     */
    snapshot() {
        const players = [...this.players.values()].map((player) => ({
            ...player,
            pos: { ...player.pos },
        }));
        return {
            status: this.status,
            playerId: this.playerId,
            players,
            scores: { ...this.scores },
            scoreLimit: this.scoreLimit,
            round: this.round,
            winnerId: this.winnerId,
            latencyMs: this.latencyMs,
        };
    }
    /**
     * Changes and announces the local display name.
     *
     * @param name - Untrusted display name entered by the local player.
     * @returns Nothing.
     * Sends a join update when the transport is connected.
     */
    setName(name) {
        this.name = cleanPlayerName(name);
        this.send({ v: BOW_PROTOCOL_VERSION, type: 'join', name: this.name });
    }
    /**
     * Publishes the local player's latest transform and animation state.
     *
     * @param update - Sequence, transform, draw, and animation values for one state frame.
     * @returns Whether the update was sent through an open transport.
     */
    sendState(update) {
        return this.send({ v: BOW_PROTOCOL_VERSION, type: 'state', ...update });
    }
    /**
     * Announces a newly fired arrow to peers.
     *
     * @param arrowId - Unique arrow identifier generated by the firing client.
     * @param origin - Arrow origin in world meters.
     * @param velocity - Arrow velocity in meters per second.
     * @returns Whether the message was sent through an open transport.
     */
    sendShot(arrowId, origin, velocity) {
        return this.send({ v: BOW_PROTOCOL_VERSION, type: 'shot', arrowId, origin, velocity });
    }
    /**
     * Reports a client-authoritative hit to the target player.
     *
     * @param targetId - Player ID that should apply the damage.
     * @param arrowId - Unique arrow ID responsible for the hit.
     * @param damage - Damage in health points.
     * @param isHeadshot - Whether the hit used the head damage volume.
     * @returns Whether the message was sent through an open transport.
     */
    sendHit(targetId, arrowId, damage, isHeadshot) {
        return this.send({
            v: BOW_PROTOCOL_VERSION,
            type: 'hit',
            targetId,
            arrowId,
            damage,
            head: isHeadshot,
        });
    }
    /**
     * Reports a local death for authoritative room scoring.
     *
     * @param killerId - Player ID credited with the elimination.
     * @returns Whether the message was sent through an open transport.
     */
    sendDeath(killerId) {
        return this.send({ v: BOW_PROTOCOL_VERSION, type: 'death', killerId });
    }
    /**
     * Sends a timestamped latency probe.
     *
     * @returns Whether the message was sent through an open transport.
     */
    ping() {
        return this.send({ v: BOW_PROTOCOL_VERSION, type: 'ping', sentAt: performance.now() });
    }
    // Forwards a validated protocol message to the transport.
    send(message) {
        return this.transport.send(message);
    }
    // Changes connection status and publishes a snapshot only when the value changed.
    setStatus(status) {
        if (this.status === status) {
            return;
        }
        this.status = status;
        this.emit(null);
    }
    // Publishes one message and the resulting immutable session snapshot.
    emit(message) {
        const snapshot = this.snapshot();
        for (const listener of this.listeners) {
            listener(message, snapshot);
        }
    }
    // Opens the transport and installs a heartbeat after a successful connection.
    tryConnect(isReconnect) {
        if (this.isStopped || this.status === 'full') {
            return;
        }
        this.setStatus(isReconnect ? 'reconnecting' : 'connecting');
        void this.transport
            .connect()
            .then(() => this.handleConnectedTransport())
            .catch((error) => {
            console.warn('Bow multiplayer connection attempt failed.', { error });
            this.scheduleReconnect();
        });
    }
    // Resets backoff, announces the player, and starts the latency heartbeat.
    handleConnectedTransport() {
        if (this.isStopped) {
            return;
        }
        this.reconnectAttempt = 0;
        this.send({ v: BOW_PROTOCOL_VERSION, type: 'join', name: this.name });
        if (this.heartbeatTimer !== null) {
            window.clearInterval(this.heartbeatTimer);
        }
        this.heartbeatTimer = window.setInterval(() => {
            this.ping();
        }, HEARTBEAT_INTERVAL_MS);
    }
    // Schedules the next exponentially backed-off connection attempt.
    scheduleReconnect() {
        const cannotReconnect = this.isStopped || this.status === 'full' || this.reconnectTimer !== null;
        if (cannotReconnect) {
            return;
        }
        this.setStatus('reconnecting');
        this.reconnectAttempt += 1;
        const exponentialDelay = INITIAL_RECONNECT_DELAY_MS * 2 ** (this.reconnectAttempt - BOW_PROTOCOL_VERSION);
        const cappedDelay = Math.min(MAX_RECONNECT_DELAY_MS, exponentialDelay);
        const jitter = MIN_RECONNECT_JITTER + Math.random() * RECONNECT_JITTER_RANGE;
        const delayMs = cappedDelay * jitter;
        this.telemetry?.recordReconnect(this.reconnectAttempt, delayMs);
        this.reconnectTimer = window.setTimeout(() => {
            this.reconnectTimer = null;
            this.tryConnect(true);
        }, delayMs);
    }
    // Handles transport status changes separately from decoded protocol messages.
    handleTransportStatus(event) {
        if (event.status === 'connected') {
            this.setStatus('connected');
            return;
        }
        if (this.heartbeatTimer !== null) {
            window.clearInterval(this.heartbeatTimer);
        }
        this.heartbeatTimer = null;
        this.scheduleReconnect();
    }
    // Stops reconnecting after the room rejects this client at capacity.
    handleFullRoom(message) {
        this.status = 'full';
        this.isStopped = true;
        if (this.reconnectTimer !== null) {
            window.clearTimeout(this.reconnectTimer);
        }
        this.reconnectTimer = null;
        this.transport.close();
        this.emit(message);
    }
    // Replaces local roster state from the server's initial room snapshot.
    handleWelcome(message) {
        this.playerId = message.playerId;
        this.scoreLimit = message.scoreLimit;
        this.round = message.round;
        this.scores = { ...message.scores };
        this.winnerId = null;
        this.players.clear();
        for (const player of message.roster) {
            this.players.set(player.id, {
                ...player,
                local: player.id === message.playerId,
                seq: -1,
                pos: { x: 0, y: 0, z: 0 },
                yaw: 0,
                pitch: 0,
                draw: 0,
                anim: 'ready',
                deaths: 0,
            });
        }
        const remotePlayerIds = message.roster
            .filter((player) => player.id !== message.playerId)
            .map((player) => player.id);
        this.telemetry?.setRemotePlayers(remotePlayerIds);
    }
    // Adds a new player or updates the name and slot of an existing one.
    handleJoin(message) {
        const existingPlayer = this.players.get(message.playerId);
        this.players.set(message.playerId, {
            id: message.playerId,
            name: message.name,
            slot: message.slot,
            local: message.playerId === this.playerId,
            seq: existingPlayer?.seq ?? -1,
            pos: existingPlayer?.pos ?? { x: 0, y: 0, z: 0 },
            yaw: existingPlayer?.yaw ?? 0,
            pitch: existingPlayer?.pitch ?? 0,
            draw: existingPlayer?.draw ?? 0,
            anim: existingPlayer?.anim ?? 'ready',
            deaths: existingPlayer?.deaths ?? 0,
        });
        if (this.scores[message.playerId] === undefined) {
            this.scores[message.playerId] = 0;
        }
        if (message.playerId !== this.playerId) {
            const remotePlayerIds = [...this.players.values()]
                .filter((player) => !player.local)
                .map((player) => player.id);
            this.telemetry?.setRemotePlayers(remotePlayerIds);
        }
    }
    // Applies only monotonic remote state frames to prevent animation rewinds.
    handleState(message) {
        const player = this.players.get(message.playerId);
        if (!player || message.seq <= player.seq) {
            return;
        }
        Object.assign(player, {
            seq: message.seq,
            pos: { ...message.pos },
            yaw: message.yaw,
            pitch: message.pitch,
            draw: message.draw,
            anim: message.anim,
        });
        if (!player.local) {
            this.telemetry?.recordRemoteState(message.playerId);
        }
    }
    // Marks a known victim dead while the room separately broadcasts updated scores.
    handleDeath(message) {
        const player = this.players.get(message.playerId);
        if (!player) {
            return;
        }
        player.deaths += 1;
        player.anim = 'dead';
    }
    // Clears round-local state after the Durable Object alarm fires.
    handleRoundReset(message) {
        this.round = message.round;
        this.winnerId = null;
        for (const playerId of Object.keys(this.scores)) {
            this.scores[playerId] = 0;
        }
        for (const player of this.players.values()) {
            player.anim = 'ready';
        }
    }
    // Removes a departed player from roster, score, and telemetry state.
    handleLeave(message) {
        this.players.delete(message.playerId);
        delete this.scores[message.playerId];
        this.telemetry?.removeRemotePlayer(message.playerId);
    }
    // Computes round-trip latency from the echoed monotonic browser timestamp.
    handlePong(message) {
        this.latencyMs = Math.max(0, performance.now() - message.sentAt);
        this.telemetry?.recordRtt(this.latencyMs);
    }
    // Applies one recognized server message to session state.
    handleMessage(message) {
        switch (message.type) {
            case 'welcome':
                this.handleWelcome(message);
                break;
            case 'join':
                this.handleJoin(message);
                break;
            case 'state':
                this.handleState(message);
                break;
            case 'death':
                this.handleDeath(message);
                break;
            case 'scores':
                this.scores = { ...message.scores };
                break;
            case 'round_end':
                this.scores = { ...message.scores };
                this.winnerId = message.winnerId;
                break;
            case 'round_reset':
                this.handleRoundReset(message);
                break;
            case 'leave':
                this.handleLeave(message);
                break;
            case 'pong':
                this.handlePong(message);
                break;
            case 'shot':
            case 'hit':
                break;
            case 'full':
                // Capacity rejection is handled before this switch because it stops the session.
                break;
        }
    }
    // Converts transport events into status changes or validated session messages.
    onTransport = (event) => {
        if (event.kind === 'status') {
            this.handleTransportStatus(event);
            return;
        }
        const message = parseServerMessage(event.message);
        if (!message) {
            return;
        }
        if (message.type === 'full') {
            this.handleFullRoom(message);
            return;
        }
        this.handleMessage(message);
        this.emit(message);
    };
}
