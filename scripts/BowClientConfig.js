/** Selects solo or online play and resolves the fixed multiplayer endpoint. */
/** Production Durable Object ingress retained for published online play. */
export const BOW_WEBSOCKET_ENDPOINT = 'wss://bowgame.minjunesv0.workers.dev/ws';
const BLITZ_APP_HOST = 'app.blitz.dev';
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
/**
 * Reports whether a hostname is a supported loopback development host.
 *
 * @param hostname - Normalized URL hostname.
 * @returns Whether local WebSocket endpoint overrides may be honored.
 */
export function isBowLoopbackHost(hostname) {
    return LOOPBACK_HOSTS.has(hostname.toLowerCase());
}
/**
 * Reports whether a hostname is a real tenant below `app.blitz.dev`.
 *
 * @param hostname - Normalized URL hostname.
 * @returns Whether the published page should default to online play.
 */
export function isBlitzAppSubdomain(hostname) {
    const normalizedHostname = hostname.toLowerCase();
    const suffix = `.${BLITZ_APP_HOST}`;
    if (!normalizedHostname.endsWith(suffix)) {
        return false;
    }
    const tenantPrefix = normalizedHostname.slice(0, -suffix.length);
    return tenantPrefix.split('.').every((label) => label.length > 0);
}
function resolveEndpoint(pageUrl) {
    const requestedEndpoint = pageUrl.searchParams.get('ws');
    if (!requestedEndpoint || !isBowLoopbackHost(pageUrl.hostname)) {
        return new URL(BOW_WEBSOCKET_ENDPOINT);
    }
    try {
        const parsedEndpoint = new URL(requestedEndpoint);
        if (parsedEndpoint.protocol === 'ws:' || parsedEndpoint.protocol === 'wss:') {
            return parsedEndpoint;
        }
    }
    catch {
        return new URL(BOW_WEBSOCKET_ENDPOINT);
    }
    return new URL(BOW_WEBSOCKET_ENDPOINT);
}
/**
 * Resolves gameplay mode and the compatible room/name connection URL.
 *
 * @param pageUrl - Current browser page URL.
 * @param playerName - Sanitized display name sent in the unchanged connection query.
 * @returns Solo configuration or an online endpoint carrying `room` and `name`.
 */
export function resolveBowClientConfig(pageUrl, playerName) {
    const isSoloForced = pageUrl.searchParams.get('solo') === '1';
    const isOnlineForced = pageUrl.searchParams.get('online') === '1';
    const isPublishedOnline = isBlitzAppSubdomain(pageUrl.hostname);
    const mode = !isSoloForced && (isOnlineForced || isPublishedOnline) ? 'online' : 'solo';
    if (mode === 'solo') {
        return { mode, socketUrl: null };
    }
    const endpoint = resolveEndpoint(pageUrl);
    endpoint.searchParams.set('room', 'main');
    endpoint.searchParams.set('name', playerName);
    return { mode, socketUrl: endpoint.href };
}
