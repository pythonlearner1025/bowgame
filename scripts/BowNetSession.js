import { BOW_PROTOCOL_VERSION, cleanPlayerName, parseServerMessage } from './BowProtocol.js';
/** Player-slot/session state is deliberately separate from the WebSocket transport. */
export class BowNetSession {
    transport;
    name;
    telemetry;
    status = 'disconnected';
    playerId = null;
    players = new Map();
    scores = {};
    scoreLimit = 20;
    round = 1;
    winnerId = null;
    latencyMs = null;
    listeners = new Set();
    removeTransportListener = null;
    reconnectTimer = null;
    heartbeatTimer = null;
    attempt = 0;
    stopped = true;
    constructor(transport, name, telemetry = null) {
        this.transport = transport;
        this.name = name;
        this.telemetry = telemetry;
        this.name = cleanPlayerName(name);
    }
    start() { if (!this.stopped)
        return; this.stopped = false; this.removeTransportListener = this.transport.onMessage(this.onTransport); this.tryConnect(false); }
    stop() { this.stopped = true; if (this.reconnectTimer !== null)
        window.clearTimeout(this.reconnectTimer); if (this.heartbeatTimer !== null)
        window.clearInterval(this.heartbeatTimer); this.reconnectTimer = this.heartbeatTimer = null; this.removeTransportListener?.(); this.removeTransportListener = null; this.transport.close(); this.setStatus('disconnected'); }
    onChange(listener) { this.listeners.add(listener); listener(null, this.snapshot()); return () => this.listeners.delete(listener); }
    getName() { return this.name; }
    snapshot() { return { status: this.status, playerId: this.playerId, players: [...this.players.values()].map(player => ({ ...player, pos: { ...player.pos } })), scores: { ...this.scores }, scoreLimit: this.scoreLimit, round: this.round, winnerId: this.winnerId, latencyMs: this.latencyMs }; }
    setName(name) { this.name = cleanPlayerName(name); this.send({ v: 1, type: 'join', name: this.name }); }
    sendState(seq, pos, yaw, pitch, draw, anim) { return this.send({ v: 1, type: 'state', seq, pos, yaw, pitch, draw, anim }); }
    sendShot(arrowId, origin, velocity) { return this.send({ v: 1, type: 'shot', arrowId, origin, velocity }); }
    sendHit(targetId, arrowId, damage, head) { return this.send({ v: 1, type: 'hit', targetId, arrowId, damage, head }); }
    sendDeath(killerId) { return this.send({ v: 1, type: 'death', killerId }); }
    ping() { return this.send({ v: 1, type: 'ping', sentAt: performance.now() }); }
    send(message) { return this.transport.send(message); }
    setStatus(status) { if (this.status === status)
        return; this.status = status; this.emit(null); }
    emit(message) { const snapshot = this.snapshot(); for (const listener of this.listeners)
        listener(message, snapshot); }
    tryConnect(reconnecting) {
        if (this.stopped || this.status === 'full')
            return;
        this.setStatus(reconnecting ? 'reconnecting' : 'connecting');
        void this.transport.connect().then(() => {
            if (this.stopped)
                return;
            this.attempt = 0;
            this.send({ v: BOW_PROTOCOL_VERSION, type: 'join', name: this.name });
            if (this.heartbeatTimer !== null)
                window.clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = window.setInterval(() => this.send({ v: 1, type: 'ping', sentAt: performance.now() }), 20_000);
        }).catch(() => this.scheduleReconnect());
    }
    scheduleReconnect() {
        if (this.stopped || this.status === 'full' || this.reconnectTimer !== null)
            return;
        this.setStatus('reconnecting');
        const attempt = ++this.attempt, delay = Math.min(30_000, 500 * 2 ** (attempt - 1)) * (.75 + Math.random() * .5);
        this.telemetry?.recordReconnect(attempt, delay);
        this.reconnectTimer = window.setTimeout(() => { this.reconnectTimer = null; this.tryConnect(true); }, delay);
    }
    onTransport = (event) => {
        if (event.kind === 'status') {
            if (event.status === 'connected')
                this.setStatus('connected');
            else {
                if (this.heartbeatTimer !== null)
                    window.clearInterval(this.heartbeatTimer);
                this.heartbeatTimer = null;
                this.scheduleReconnect();
            }
            return;
        }
        const message = parseServerMessage(event.message);
        if (!message)
            return;
        if (message.type === 'full') {
            this.status = 'full';
            this.stopped = true;
            if (this.reconnectTimer !== null)
                window.clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
            this.transport.close();
            this.emit(message);
            return;
        }
        switch (message.type) {
            case 'welcome': {
                this.playerId = message.playerId;
                this.scoreLimit = message.scoreLimit;
                this.round = message.round;
                this.scores = { ...message.scores };
                this.winnerId = null;
                this.players.clear();
                for (const player of message.roster)
                    this.players.set(player.id, { ...player, local: player.id === message.playerId, seq: -1, pos: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, draw: 0, anim: 'ready', deaths: 0 });
                this.telemetry?.setRemotePlayers(message.roster.filter(player => player.id !== message.playerId).map(player => player.id));
                break;
            }
            case 'join': {
                const existing = this.players.get(message.playerId);
                this.players.set(message.playerId, { id: message.playerId, name: message.name, slot: message.slot, local: message.playerId === this.playerId, seq: existing?.seq ?? -1, pos: existing?.pos ?? { x: 0, y: 0, z: 0 }, yaw: existing?.yaw ?? 0, pitch: existing?.pitch ?? 0, draw: existing?.draw ?? 0, anim: existing?.anim ?? 'ready', deaths: existing?.deaths ?? 0 });
                this.scores[message.playerId] ??= 0;
                if (message.playerId !== this.playerId)
                    this.telemetry?.setRemotePlayers([...this.players.values()].filter(player => !player.local).map(player => player.id));
                break;
            }
            case 'state': {
                const player = this.players.get(message.playerId);
                if (player && message.seq > player.seq) {
                    Object.assign(player, { seq: message.seq, pos: { ...message.pos }, yaw: message.yaw, pitch: message.pitch, draw: message.draw, anim: message.anim });
                    if (!player.local)
                        this.telemetry?.recordRemoteState(message.playerId);
                }
                break;
            }
            case 'death': {
                const player = this.players.get(message.playerId);
                if (player) {
                    player.deaths++;
                    player.anim = 'dead';
                }
                break;
            }
            case 'scores':
                this.scores = { ...message.scores };
                break;
            case 'round_end':
                this.scores = { ...message.scores };
                this.winnerId = message.winnerId;
                break;
            case 'round_reset':
                this.round = message.round;
                this.winnerId = null;
                for (const id of Object.keys(this.scores))
                    this.scores[id] = 0;
                for (const player of this.players.values())
                    player.anim = 'ready';
                break;
            case 'leave':
                this.players.delete(message.playerId);
                delete this.scores[message.playerId];
                this.telemetry?.removeRemotePlayer(message.playerId);
                break;
            case 'pong':
                this.latencyMs = Math.max(0, performance.now() - message.sentAt);
                this.telemetry?.recordRtt(this.latencyMs);
                break;
        }
        this.emit(message);
    };
}
