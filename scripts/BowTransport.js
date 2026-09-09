export class WebSocketTransport {
    url;
    socket = null;
    handlers = new Set();
    manuallyClosed = false;
    constructor(url) {
        this.url = url;
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
                    this.emit({ kind: 'message', message: JSON.parse(event.data) });
                }
                catch { }
            });
            socket.addEventListener('close', event => {
                if (this.socket === socket)
                    this.socket = null;
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
        return false; this.socket.send(JSON.stringify(message)); return true; }
    onMessage(handler) { this.handlers.add(handler); return () => this.handlers.delete(handler); }
    close() { this.manuallyClosed = true; this.socket?.close(1000, 'Client closed'); this.socket = null; }
    emit(event) { for (const handler of this.handlers)
        handler(event); }
}
