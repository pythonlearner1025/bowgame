/**
 * Aggregates payload-free room metrics and emits structured Worker logs.
 * It does not retain message contents, player names, or durable state.
 */

// Activity flushes at most once per minute so telemetry does not keep an idle room awake.
const SUMMARY_WINDOW_MS = 60_000;

interface Counter {
  count: number;
  bytes: number;
}

type StructuredLog = (entry: Record<string, unknown>, isError?: boolean) => void;

/**
 * Measures a string's encoded UTF-8 payload size.
 *
 * @param value - JavaScript string to encode.
 * @returns Encoded size in bytes.
 */
export function utf8MessageBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

/** Collects bounded counters for the current active room window. */
export class RoomTelemetry {
  private startedAt: number;
  private inbound: Record<string, Counter> = Object.create(null);
  private outbound: Record<string, Counter> = Object.create(null);
  private broadcastFanOut = 0;
  private maxMessageBytes = 0;

  /**
   * Starts a metrics window around the supplied structured-log writer.
   *
   * @param write - Sink that serializes one metadata-only log entry.
   * @param now - Window start as Unix time in milliseconds.
   */
  constructor(
    private readonly write: StructuredLog,
    now = Date.now(),
  ) {
    this.startedAt = now;
  }

  /**
   * Emits one structured lifecycle or gameplay event.
   *
   * @param event - Stable event name used for log queries.
   * @param fields - Additional payload-free metadata.
   * @returns Nothing.
   */
  event(event: string, fields: Record<string, unknown> = {}): void {
    this.write({
      service: 'bow_room',
      event,
      timestamp: new Date().toISOString(),
      ...fields,
    });
  }

  /**
   * Emits a structured exception without including WebSocket payloads.
   *
   * @param handler - Room callback in which the exception occurred.
   * @param error - Unknown thrown value.
   * @param connectedCount - Number of accepted sockets at failure time.
   * @returns Nothing.
   */
  exception(handler: string, error: unknown, connectedCount: number): void {
    this.write(
      {
        service: 'bow_room',
        event: 'exception',
        timestamp: new Date().toISOString(),
        handler,
        errorName: error instanceof Error ? error.name : 'UnknownError',
        errorMessage: error instanceof Error ? error.message : String(error),
        connectedCount,
      },
      true,
    );
  }

  /**
   * Counts one inbound protocol frame.
   *
   * @param type - Recognized message type or `invalid`.
   * @param bytes - Encoded frame length in bytes.
   * @returns Nothing.
   */
  recordInbound(type: string, bytes: number): void {
    this.bump(this.inbound, type, bytes, 1);
    this.maxMessageBytes = Math.max(this.maxMessageBytes, bytes);
  }

  /**
   * Counts outbound delivery, including broadcast fan-out.
   *
   * @param type - Outbound protocol message type.
   * @param bytes - Encoded frame length in bytes.
   * @param recipients - Number of sockets that received the frame.
   * @param isBroadcast - Whether the delivery contributes to broadcast fan-out.
   * @returns Nothing.
   */
  recordOutbound(type: string, bytes: number, recipients = 1, isBroadcast = false): void {
    this.bump(this.outbound, type, bytes, recipients);

    if (isBroadcast) {
      this.broadcastFanOut += recipients;
    }

    this.maxMessageBytes = Math.max(this.maxMessageBytes, bytes);
  }

  /**
   * Emits and resets the current summary when its activity window is due.
   *
   * @param connectedCount - Number of accepted sockets at flush time.
   * @param now - Current Unix time in milliseconds.
   * @param force - Whether to flush before the normal one-minute boundary.
   * @returns The emitted summary, or `null` when the window is not due.
   */
  flushIfDue(
    connectedCount: number,
    now = Date.now(),
    force = false,
  ): Record<string, unknown> | null {
    const windowMs = now - this.startedAt;

    if (!force && windowMs < SUMMARY_WINDOW_MS) {
      return null;
    }

    const summary = {
      service: 'bow_room',
      event: 'summary',
      timestamp: new Date(now).toISOString(),
      windowStartedAt: new Date(this.startedAt).toISOString(),
      windowMs,
      inboundMessagesByType: this.inbound,
      outboundMessagesByType: this.outbound,
      broadcastFanOut: this.broadcastFanOut,
      maxMessageBytes: this.maxMessageBytes,
      connectedCount,
    };

    this.write(summary);
    this.startedAt = now;
    this.inbound = Object.create(null);
    this.outbound = Object.create(null);
    this.broadcastFanOut = 0;
    this.maxMessageBytes = 0;

    return summary;
  }

  // Adds a weighted delivery count to one message-type counter.
  private bump(target: Record<string, Counter>, type: string, bytes: number, count: number): void {
    const entry = target[type] ?? { count: 0, bytes: 0 };
    target[type] = entry;
    entry.count += count;
    entry.bytes += bytes * count;
  }
}
