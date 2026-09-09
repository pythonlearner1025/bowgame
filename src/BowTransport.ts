/**
 * Adapts browser WebSockets to the game's small transport boundary.
 * It does not own reconnection policy, protocol validation, or gameplay state.
 */

import type { ClientMessage, ServerMessage } from './BowProtocol.js';
import { utf8ByteLength, type BowTelemetrySink } from './BowPerformance.js';

// A normal close distinguishes intentional shutdown from a connection failure.
const NORMAL_CLOSE_CODE = 1000;

/** A decoded message or connection-status transition emitted by a transport. */
export type TransportEvent =
  | { kind: 'message'; message: ServerMessage }
  | { kind: 'status'; status: 'connected' | 'disconnected'; reason?: string };

/** Receives transport events in delivery order. */
export type TransportHandler = (event: TransportEvent) => void;

/** Backend-neutral multiplayer connection used by `BowNetSession`. */
export interface Transport {
  connect(): Promise<void>;
  send(message: ClientMessage): boolean;
  onMessage(handler: TransportHandler): () => void;
  close(): void;
}

/** Connects the multiplayer session to a JSON-over-WebSocket endpoint. */
export class WebSocketTransport implements Transport {
  private socket: WebSocket | null = null;
  private readonly handlers = new Set<TransportHandler>();
  private isManuallyClosed = false;

  /**
   * Creates a transport without opening its socket.
   *
   * @param url - Absolute WebSocket endpoint URL.
   * @param telemetry - Optional sink for payload-free network measurements.
   */
  constructor(
    private readonly url: string,
    private readonly telemetry: BowTelemetrySink | null = null,
  ) {}

  /**
   * Opens the socket and resolves after the browser reports it connected.
   *
   * @returns A promise that rejects when the initial connection fails.
   * Replaces any stale socket and emits a connected status event as side effects.
   */
  connect(): Promise<void> {
    this.isManuallyClosed = false;

    if (this.socket?.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }

    this.socket?.close();

    return new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(this.url);
      let isOpen = false;
      this.socket = socket;

      socket.addEventListener(
        'open',
        () => {
          if (this.socket !== socket) {
            return;
          }

          isOpen = true;
          this.emit({ kind: 'status', status: 'connected' });
          resolve();
        },
        { once: true },
      );

      socket.addEventListener('message', (event) => {
        if (typeof event.data !== 'string') {
          return;
        }

        try {
          const message = JSON.parse(event.data) as ServerMessage;
          this.telemetry?.recordNetwork(
            'inbound',
            message.type ?? 'invalid',
            utf8ByteLength(event.data),
          );
          this.emit({ kind: 'message', message });
        } catch (error) {
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

      socket.addEventListener(
        'error',
        () => {
          if (!isOpen) {
            reject(new Error('WebSocket connection failed'));
          }
        },
        { once: true },
      );
    });
  }

  /**
   * Sends one protocol message when the socket is ready.
   *
   * @param message - Validated client message to encode as JSON.
   * @returns Whether the message was handed to an open socket.
   * Records outbound byte counts when telemetry is enabled.
   */
  send(message: ClientMessage): boolean {
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
  onMessage(handler: TransportHandler): () => void {
    this.handlers.add(handler);

    return () => this.handlers.delete(handler);
  }

  /**
   * Closes the active socket without triggering session reconnection.
   *
   * @returns Nothing.
   * Emits the browser's normal WebSocket close handshake as a side effect.
   */
  close(): void {
    this.isManuallyClosed = true;
    this.socket?.close(NORMAL_CLOSE_CODE, 'Client closed');
    this.socket = null;
  }

  // Delivers an event to a snapshot of the current listener set.
  private emit(event: TransportEvent): void {
    for (const handler of this.handlers) {
      handler(event);
    }
  }
}
