/**
 * Routes allowed WebSocket upgrades to room Durable Objects and serves no static assets.
 * It does not own room gameplay or protocol parsing.
 */

export { BowRoom } from './room.js';
import { isAllowedBowOrigin } from './origin.js';

// Room names are bounded before Durable Object lookup to prevent oversized routing keys.
const MAX_ROOM_NAME_CHARACTERS = 64;

// HTTP 426 communicates that `/ws` requires the WebSocket Upgrade header.
const UPGRADE_REQUIRED_STATUS = 426;

// HTTP 403 rejects browser origins outside published Kite tenants and local development.
const FORBIDDEN_STATUS = 403;

// HTTP 404 makes explicit that this Worker is not a static game host.
const NOT_FOUND_STATUS = 404;

// HTTP 500 reports an explicitly handled Worker failure without exposing exception details.
const INTERNAL_ERROR_STATUS = 500;

/**
 * Applies ingress checks in a stable order before looking up a room.
 *
 * @param request - Incoming HTTP or WebSocket-upgrade request.
 * @param env - Worker bindings containing the room Durable Object namespace.
 * @returns A rejection response or the room's WebSocket response.
 */
export async function handleBowRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname !== '/ws') {
    return new Response('Not found', { status: NOT_FOUND_STATUS });
  }

  if (!isAllowedBowOrigin(request.headers.get('Origin'))) {
    return new Response('Forbidden origin', { status: FORBIDDEN_STATUS });
  }

  const isWebSocket = request.headers.get('Upgrade')?.toLowerCase() === 'websocket';

  if (!isWebSocket) {
    return new Response('WebSocket upgrade required', {
      status: UPGRADE_REQUIRED_STATUS,
    });
  }

  const roomName = (url.searchParams.get('room') || 'main').slice(0, MAX_ROOM_NAME_CHARACTERS);

  return env.BOW_ROOM.getByName(roomName).fetch(request);
}

/** Forwards fetches through the bounded ingress handler with structured failure logging. */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handleBowRequest(request, env);
    } catch (error) {
      const url = new URL(request.url);
      console.error(
        JSON.stringify({
          service: 'bow_worker',
          event: 'exception',
          timestamp: new Date().toISOString(),
          handler: 'fetch',
          path: url.pathname,
          errorName: error instanceof Error ? error.name : 'UnknownError',
          errorMessage: error instanceof Error ? error.message : String(error),
        }),
      );

      return new Response('Worker unavailable', { status: INTERNAL_ERROR_STATUS });
    }
  },
} satisfies ExportedHandler<Env>;
