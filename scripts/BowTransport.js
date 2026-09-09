import { utf8ByteLength } from './BowPerformance.js';
export class WebSocketTransport {
    url;
    telemetry;
    socket = null;
    handlers = new Set();
    manuallyClosed = false;
    constructor(url, telemetry = null) {
        this.url = url;
        this.telemetry = telemetry;
    }
    connect() {
        this.manuallyClosed = false;
        if (this.socket?.readyState === WebSocket.OPEN)
            return Promise.resolve();
        this.socket?.close();
        return new Promise((resolve, reject) => {
            const socket = new WebSocket(this.url);
            this.socket = socket;
            let opened = false;
            socket.addEventListener('open', () => { if (this.socket !== socket)
                return; opened = true; this.emit({ kind: 'status', status: 'connected' }); resolve(); }, { once: true });
            socket.addEventListener('message', event => {
                if (typeof event.data !== 'string')
                    return;
                try {
                    const message = JSON.parse(event.data);
                    this.telemetry?.recordNetwork('inbound', message.type ?? 'invalid', utf8ByteLength(event.data));
                    this.emit({ kind: 'message', message });
                }
                catch { }
            });
            socket.addEventListener('close', event => {
                if (this.socket === socket)
                    this.socket = null;
                this.telemetry?.recordSocketClose(event.code, event.wasClean);
                if (!opened)
                    reject(new Error(`WebSocket rejected (${event.code || 'network'})`));
                if (!this.manuallyClosed)
                    this.emit({ kind: 'status', status: 'disconnected', reason: event.reason || undefined });
            });
            socket.addEventListener('error', () => { if (!opened)
                reject(new Error('WebSocket connection failed')); }, { once: true });
        });
    }
    send(message) { if (this.socket?.readyState !== WebSocket.OPEN)
        return false; const encoded = JSON.stringify(message); this.socket.send(encoded); this.telemetry?.recordNetwork('outbound', message.type, utf8ByteLength(encoded)); return true; }
    onMessage(handler) { this.handlers.add(handler); return () => this.handlers.delete(handler); }
    close() { this.manuallyClosed = true; this.socket?.close(1000, 'Client closed'); this.socket = null; }
    emit(event) { for (const handler of this.handlers)
        handler(event); }
}
