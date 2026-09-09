/**
 * Adapts browser WebSockets to the game's small transport boundary.
 * It does not own reconnection policy, protocol validation, or gameplay state.
 */
import { utf8ByteLength } from './BowPerformance.js';
// A normal close distinguishes intentional shutdown from a connection failure.
const NORMAL_CLOSE_CODE = 1000;
/** Connects the multiplayer session to a JSON-over-WebSocket endpoint. */
export class WebSocketTransport {
    url;
    telemetry;
    socket = null;
    handlers = new Set();
    isManuallyClosed = false;
    /**
     * Creates a transport without opening its socket.
     *
     * @param url - Absolute WebSocket endpoint URL.
     * @param telemetry - Optional sink for payload-free network measurements.
     */
    constructor(url, telemetry = null) {
        this.url = url;
        this.telemetry = telemetry;
    }
    /**
     * Opens the socket and resolves after the browser reports it connected.
     *
     * @returns A promise that rejects when the initial connection fails.
     * Replaces any stale socket and emits a connected status event as side effects.
     */
    connect() {
        this.isManuallyClosed = false;
        if (this.socket?.readyState === WebSocket.OPEN) {
            return Promise.resolve();
        }
        this.socket?.close();
        return new Promise((resolve, reject) => {
            const socket = new WebSocket(this.url);
            let isOpen = false;
            this.socket = socket;
            socket.addEventListener('open', () => {
                if (this.socket !== socket) {
                    return;
                }
                isOpen = true;
                this.emit({ kind: 'status', status: 'connected' });
                resolve();
            }, { once: true });
            socket.addEventListener('message', (event) => {
                if (typeof event.data !== 'string') {
                    return;
                }
                try {
                    const message = JSON.parse(event.data);
                    this.telemetry?.recordNetwork('inbound', message.type ?? 'invalid', utf8ByteLength(event.data));
                    this.emit({ kind: 'message', message });
                }
                catch (error) {
                    console.warn('Ignored malformed Bow WebSocket message.', { error });
                }
            });
            socket.addEventListener('close', (event) => {
                if (this.socket === socket) {
                    this.socket = null;
                }
                this.telemetry?.recordSocketClose(event.code, event.wasClean);
                if (!isOpen) {
                    reject(new Error(`WebSocket rejected (${event.code || 'network'})`));
                }
                if (!this.isManuallyClosed) {
                    this.emit({
                        kind: 'status',
                        status: 'disconnected',
                        reason: event.reason || undefined,
                    });
                }
            });
            socket.addEventListener('error', () => {
                if (!isOpen) {
                    reject(new Error('WebSocket connection failed'));
                }
            }, { once: true });
        });
    }
    /**
     * Sends one protocol message when the socket is ready.
     *
     * @param message - Validated client message to encode as JSON.
     * @returns Whether the message was handed to an open socket.
     * Records outbound byte counts when telemetry is enabled.
     */
    send(message) {
        if (this.socket?.readyState !== WebSocket.OPEN) {
            return false;
        }
        const encodedMessage = JSON.stringify(message);
        this.socket.send(encodedMessage);
        this.telemetry?.recordNetwork('outbound', message.type, utf8ByteLength(encodedMessage));
        return true;
    }
    /**
     * Registers a listener for messages and status changes.
     *
     * @param handler - Callback invoked synchronously for each event.
     * @returns A function that unregisters the callback.
     */
    onMessage(handler) {
        this.handlers.add(handler);
        return () => this.handlers.delete(handler);
    }
    /**
     * Closes the active socket without triggering session reconnection.
     *
     * @returns Nothing.
     * Emits the browser's normal WebSocket close handshake as a side effect.
     */
    close() {
        this.isManuallyClosed = true;
        this.socket?.close(NORMAL_CLOSE_CODE, 'Client closed');
        this.socket = null;
    }
    // Delivers an event to a snapshot of the current listener set.
    emit(event) {
        for (const handler of this.handlers) {
            handler(event);
        }
    }
}
