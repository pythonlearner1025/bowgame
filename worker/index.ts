/**
 * Routes WebSocket upgrades to the room Durable Object and all other requests to static assets.
 * It does not own room gameplay, protocol parsing, or asset generation.
 */

export { BowRoom } from './room.js';

// Room names are bounded before Durable Object lookup to prevent oversized routing keys.
const MAX_ROOM_NAME_CHARACTERS = 64;

// HTTP 426 communicates that `/ws` requires the WebSocket Upgrade header.
const UPGRADE_REQUIRED_STATUS = 426;

// HTTP 500 reports an explicitly handled Worker failure without exposing exception details.
const INTERNAL_ERROR_STATUS = 500;

/** Serves the static player or forwards a WebSocket upgrade to its named room. */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    try {
      if (url.pathname === '/ws') {
        const isWebSocket = request.headers.get('Upgrade')?.toLowerCase() === 'websocket';

        if (!isWebSocket) {
          return new Response('WebSocket upgrade required', {
            status: UPGRADE_REQUIRED_STATUS,
          });
        }

        const roomName = (url.searchParams.get('room') || 'main').slice(
          0,
          MAX_ROOM_NAME_CHARACTERS,
        );

        return await env.BOW_ROOM.getByName(roomName).fetch(request);
      }

      return await env.ASSETS.fetch(request);
    } catch (error) {
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
