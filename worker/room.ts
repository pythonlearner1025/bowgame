/**
 * Hosts one hibernation-friendly multiplayer room in a Cloudflare Durable Object.
 * It relays trusted-peer combat messages but does not simulate or validate gameplay.
 */

import { DurableObject } from 'cloudflare:workers';
import {
  BOW_PROTOCOL_VERSION,
  cleanPlayerName,
  parseClientMessage,
  type ClientMessage,
  type ServerMessage,
} from '../src/BowProtocol.js';
import { ROOM_CAP, SCORE_LIMIT, RoomLogic, type RoomPlayer } from './roomLogic.js';
import { RoomTelemetry, utf8MessageBytes } from './roomTelemetry.js';

// HTTP 101 completes a successful WebSocket upgrade.
const SWITCHING_PROTOCOLS_STATUS = 101;

// HTTP 426 communicates that this endpoint requires a WebSocket upgrade.
const UPGRADE_REQUIRED_STATUS = 426;

// HTTP 500 reports a handled room failure without disclosing exception details.
const INTERNAL_ERROR_STATUS = 500;

// Close code 1003 rejects binary, malformed JSON, or invalid protocol frames.
const UNSUPPORTED_DATA_CLOSE_CODE = 1003;

// Close code 1011 reports an unexpected room-side failure.
const INTERNAL_ERROR_CLOSE_CODE = 1011;

// Close code 1013 asks an over-capacity client to try again later.
const TRY_AGAIN_LATER_CLOSE_CODE = 1013;

// Completed rounds remain visible for five seconds before the next one starts.
const ROUND_RESET_DELAY_MS = 5_000;

interface Attachment extends RoomPlayer {
  round: number;
  roundEnded: boolean;
}

/** Relays one live room and reconstructs its state from WebSocket attachments after hibernation. */
export class BowRoom extends DurableObject<Env> {
  private readonly telemetry: RoomTelemetry;

  /**
   * Creates a room around generated bindings and hibernation-capable state.
   *
   * @param ctx - Durable Object state supplied by the Workers runtime.
   * @param env - Generated environment bindings supplied by the Workers runtime.
   */
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.telemetry = new RoomTelemetry((entry, isError) => {
      const encodedEntry = JSON.stringify(entry);

      if (isError) {
        console.error(encodedEntry);
      } else {
        console.log(encodedEntry);
      }
    });
    this.telemetry.event('hibernation_wake', {
      connectedCount: this.ctx.getWebSockets().length,
    });
  }

  /**
   * Accepts one WebSocket upgrade and assigns the client a room slot.
   *
   * @param request - Incoming request for this named room.
   * @returns The upgrade response, or a bounded plain-text error response.
   */
  async fetch(request: Request): Promise<Response> {
    try {
      const isWebSocket = request.headers.get('Upgrade')?.toLowerCase() === 'websocket';

      if (!isWebSocket) {
        return new Response('WebSocket upgrade required', {
          status: UPGRADE_REQUIRED_STATUS,
        });
      }

      return this.acceptConnection(request);
    } catch (error) {
      this.telemetry.exception('fetch', error, this.ctx.getWebSockets().length);

      return new Response('Room unavailable', { status: INTERNAL_ERROR_STATUS });
    }
  }

  // Accepts an upgrade and either joins the room or sends its full-room response.
  private acceptConnection(request: Request): Response {
    const existingSockets = this.ctx.getWebSockets();
    const pair = new WebSocketPair();
    const [clientSocket, serverSocket] = Object.values(pair);
    this.ctx.acceptWebSocket(serverSocket);

    if (existingSockets.length >= ROOM_CAP) {
      return this.rejectFullRoom(clientSocket, serverSocket, existingSockets.length);
    }

    const logic = this.logic();
    const playerId = crypto.randomUUID();
    const requestedName = new URL(request.url).searchParams.get('name');
    const player = logic.join(playerId, cleanPlayerName(requestedName));

    if (!player) {
      return this.rejectFullRoom(clientSocket, serverSocket, existingSockets.length);
    }

    const attachment: Attachment = {
      ...player,
      round: logic.round,
      roundEnded: logic.roundEnded,
    };
    serverSocket.serializeAttachment(attachment);
    this.sendWelcome(serverSocket, logic, playerId);
    this.broadcast(
      {
        v: BOW_PROTOCOL_VERSION,
        type: 'join',
        playerId,
        name: player.name,
        slot: player.slot,
      },
      serverSocket,
    );
    this.telemetry.event('join', {
      playerId,
      slot: player.slot,
      connectedCount: logic.players.size,
    });
    this.telemetry.flushIfDue(logic.players.size);

    return new Response(null, {
      status: SWITCHING_PROTOCOLS_STATUS,
      webSocket: clientSocket,
    });
  }

  // Sends the protocol-level full response before closing the accepted server socket.
  private rejectFullRoom(
    clientSocket: WebSocket,
    serverSocket: WebSocket,
    connectedCount: number,
  ): Response {
    this.send(serverSocket, { v: BOW_PROTOCOL_VERSION, type: 'full' });
    this.telemetry.event('full', { connectedCount, roomCap: ROOM_CAP });
    serverSocket.close(TRY_AGAIN_LATER_CLOSE_CODE, 'Room full');

    return new Response(null, {
      status: SWITCHING_PROTOCOLS_STATUS,
      webSocket: clientSocket,
    });
  }

  // Sends the joining client its complete initial room snapshot.
  private sendWelcome(socket: WebSocket, logic: RoomLogic, playerId: string): void {
    const roster = [...logic.players.values()].map(({ id, name, slot }) => ({ id, name, slot }));

    this.send(socket, {
      v: BOW_PROTOCOL_VERSION,
      type: 'welcome',
      playerId,
      roster,
      scores: logic.scores(),
      scoreLimit: SCORE_LIMIT,
      round: logic.round,
    });
  }

  /**
   * Parses and relays one client WebSocket frame.
   *
   * @param socket - Accepted server-side socket that sent the frame.
   * @param rawMessage - Text or binary frame supplied by the Workers runtime.
   * @returns A promise that resolves after any required alarm write completes.
   */
  async webSocketMessage(socket: WebSocket, rawMessage: string | ArrayBuffer): Promise<void> {
    try {
      if (typeof rawMessage !== 'string') {
        socket.close(UNSUPPORTED_DATA_CLOSE_CODE, 'JSON text only');

        return;
      }

      const message = this.parseMessageOrClose(socket, rawMessage);

      if (!message) {
        return;
      }

      this.telemetry.recordInbound(message.type, utf8MessageBytes(rawMessage));
      const attachment = this.attachment(socket);

      if (!attachment) {
        socket.close(INTERNAL_ERROR_CLOSE_CODE, 'Missing player state');

        return;
      }

      await this.handleClientMessage(socket, attachment, message);
      this.telemetry.flushIfDue(this.ctx.getWebSockets().length);
    } catch (error) {
      this.telemetry.exception('webSocketMessage', error, this.ctx.getWebSockets().length);
      this.closeAfterError(socket, 'webSocketMessage.close', 'Room error');
    }
  }

  // Parses an untrusted text frame and closes its socket when parsing fails.
  private parseMessageOrClose(socket: WebSocket, rawMessage: string): ClientMessage | null {
    let decodedMessage: unknown;

    try {
      decodedMessage = JSON.parse(rawMessage);
    } catch (error) {
      this.telemetry.exception('webSocketMessage.parse', error, this.ctx.getWebSockets().length);
      socket.close(UNSUPPORTED_DATA_CLOSE_CODE, 'Invalid JSON');

      return null;
    }

    const message = parseClientMessage(decodedMessage);

    if (!message) {
      socket.close(UNSUPPORTED_DATA_CLOSE_CODE, 'Invalid protocol message');
    }

    return message;
  }

  // Applies one validated client message to attachments, peers, or room scoring.
  private async handleClientMessage(
    socket: WebSocket,
    attachment: Attachment,
    message: ClientMessage,
  ): Promise<void> {
    switch (message.type) {
      case 'join':
        attachment.name = message.name;
        socket.serializeAttachment(attachment);
        this.broadcast({
          v: BOW_PROTOCOL_VERSION,
          type: 'join',
          playerId: attachment.id,
          name: attachment.name,
          slot: attachment.slot,
        });
        break;
      case 'state':
      case 'shot':
      case 'hit':
        this.broadcast({ ...message, playerId: attachment.id }, socket);
        break;
      case 'death':
        await this.handleDeath(attachment, message.killerId);
        break;
      case 'ping':
        this.send(socket, {
          v: BOW_PROTOCOL_VERSION,
          type: 'pong',
          sentAt: message.sentAt,
        });
        break;
    }
  }

  // Updates authoritative scoring and schedules a reset after a winning death.
  private async handleDeath(attachment: Attachment, killerId: string): Promise<void> {
    const logic = this.logic();
    const result = logic.death(attachment.id, killerId);

    if (!result.accepted) {
      return;
    }

    this.sync(logic);
    this.broadcast({
      v: BOW_PROTOCOL_VERSION,
      type: 'death',
      playerId: attachment.id,
      killerId,
    });
    this.broadcast({ v: BOW_PROTOCOL_VERSION, type: 'scores', scores: result.scores });

    if (!result.winnerId) {
      return;
    }

    this.broadcast({
      v: BOW_PROTOCOL_VERSION,
      type: 'round_end',
      winnerId: result.winnerId,
      scores: result.scores,
    });
    this.telemetry.event('round_end', {
      round: logic.round,
      winnerId: result.winnerId,
      connectedCount: logic.players.size,
    });
    await this.ctx.storage.setAlarm(Date.now() + ROUND_RESET_DELAY_MS);
  }

  /**
   * Announces a cleanly or unexpectedly closed socket to its remaining peers.
   *
   * @param socket - Socket removed by the Workers runtime.
   * @param code - WebSocket close code.
   * @param reason - Peer-supplied close reason, which is deliberately not logged.
   * @param wasClean - Whether the WebSocket close handshake completed.
   * @returns Nothing.
   */
  webSocketClose(socket: WebSocket, code: number, reason: string, wasClean: boolean): void {
    void reason;

    try {
      this.recordPlayerLeave(socket, code, wasClean);
    } catch (error) {
      this.telemetry.exception('webSocketClose', error, this.ctx.getWebSockets().length);
    }
  }

  /**
   * Logs a socket error, announces departure, and closes the failed socket.
   *
   * @param socket - Socket that encountered a runtime error.
   * @param error - Unknown error supplied by the Workers runtime.
   * @returns Nothing.
   */
  webSocketError(socket: WebSocket, error: unknown): void {
    this.telemetry.exception('webSocketError', error, this.ctx.getWebSockets().length);

    try {
      this.recordPlayerLeave(socket, INTERNAL_ERROR_CLOSE_CODE, false);
      this.closeAfterError(socket, 'webSocketError.close', 'WebSocket error');
    } catch (handlerError) {
      this.telemetry.exception(
        'webSocketError.handler',
        handlerError,
        this.ctx.getWebSockets().length,
      );
    }
  }

  // Records and broadcasts one player departure when an attachment is available.
  private recordPlayerLeave(socket: WebSocket, code: number, wasClean: boolean): void {
    const connectedCount = this.connectedCount(socket);
    const player = this.attachment(socket);

    if (player) {
      this.broadcast({ v: BOW_PROTOCOL_VERSION, type: 'leave', playerId: player.id }, socket);
      this.telemetry.event('leave', {
        playerId: player.id,
        slot: player.slot,
        code,
        wasClean,
        connectedCount,
      });
    }

    this.telemetry.flushIfDue(connectedCount);
  }

  // Closes a socket while preserving any secondary close failure in structured logs.
  private closeAfterError(socket: WebSocket, handler: string, reason: string): void {
    try {
      socket.close(INTERNAL_ERROR_CLOSE_CODE, reason);
    } catch (closeError) {
      this.telemetry.exception(handler, closeError, this.ctx.getWebSockets().length);
    }
  }

  /**
   * Starts the next round when the reset alarm fires after a completed round.
   *
   * @returns A promise resolved after state and broadcasts are updated.
   */
  async alarm(): Promise<void> {
    try {
      const logic = this.logic();

      if (!logic.roundEnded) {
        return;
      }

      const resetResult = logic.reset();
      this.sync(logic);
      this.broadcast({
        v: BOW_PROTOCOL_VERSION,
        type: 'round_reset',
        round: resetResult.round,
      });
      this.telemetry.event('round_reset', {
        round: resetResult.round,
        connectedCount: logic.players.size,
      });
      this.telemetry.flushIfDue(logic.players.size);
    } catch (error) {
      this.telemetry.exception('alarm', error, this.ctx.getWebSockets().length);
      throw error;
    }
  }

  // Narrows a hibernation attachment to the room's serializable player state.
  private attachment(socket: WebSocket): Attachment | null {
    const value: unknown = socket.deserializeAttachment();

    return value && typeof value === 'object' ? (value as Attachment) : null;
  }

  // Counts open sockets other than an optional departing socket.
  private connectedCount(except?: WebSocket): number {
    let count = 0;

    for (const socket of this.ctx.getWebSockets()) {
      if (socket !== except && socket.readyState === WebSocket.OPEN) {
        count += 1;
      }
    }

    return count;
  }

  // Reconstructs pure room state from all current hibernation attachments.
  private logic(): RoomLogic {
    const attachments = this.ctx
      .getWebSockets()
      .map((socket) => this.attachment(socket))
      .filter((value): value is Attachment => value !== null);
    const round = Math.max(BOW_PROTOCOL_VERSION, ...attachments.map((player) => player.round));
    const isRoundEnded = attachments.some((player) => player.roundEnded);
    const players = attachments.map(({ id, name, slot, kills }) => ({
      id,
      name,
      slot,
      kills,
    }));

    return new RoomLogic(round, isRoundEnded, players);
  }

  // Writes current pure room state back to every matching socket attachment.
  private sync(logic: RoomLogic): void {
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = this.attachment(socket);
      const player = attachment ? logic.players.get(attachment.id) : null;

      if (player) {
        socket.serializeAttachment({
          ...player,
          round: logic.round,
          roundEnded: logic.roundEnded,
        } satisfies Attachment);
      }
    }
  }

  // Encodes and sends one server message while recording its byte count.
  private send(socket: WebSocket, message: ServerMessage): void {
    const encodedMessage = JSON.stringify(message);
    socket.send(encodedMessage);
    this.telemetry.recordOutbound(message.type, utf8MessageBytes(encodedMessage));
  }

  // Encodes one server message and sends it to all open sockets except an optional sender.
  private broadcast(message: ServerMessage, except?: WebSocket): void {
    const encodedMessage = JSON.stringify(message);
    const messageBytes = utf8MessageBytes(encodedMessage);
    let recipients = 0;

    for (const socket of this.ctx.getWebSockets()) {
      const canReceive = socket !== except && socket.readyState === WebSocket.OPEN;

      if (!canReceive) {
        continue;
      }

      try {
        socket.send(encodedMessage);
        recipients += 1;
      } catch (error) {
        this.telemetry.exception('broadcast.send', error, this.connectedCount());
      }
    }

    this.telemetry.recordOutbound(message.type, messageBytes, recipients, true);
  }
}
