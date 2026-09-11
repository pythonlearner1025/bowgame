/** Parses and validates browser origins before they can reach a multiplayer room. */

const BLITZ_APP_HOST = 'app.blitz.dev';
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Returns whether every label before the fixed host suffix is nonempty.
 *
 * @param hostname - Normalized hostname to inspect.
 * @returns Whether the hostname represents a real published tenant.
 */
function isBlitzAppSubdomain(hostname: string): boolean {
  const suffix = `.${BLITZ_APP_HOST}`;

  if (!hostname.endsWith(suffix)) {
    return false;
  }

  const tenantPrefix = hostname.slice(0, -suffix.length);

  return tenantPrefix.split('.').every((label) => label.length > 0);
}

/**
 * Parses a syntactically valid HTTP(S) Origin header without accepting URL paths or credentials.
 *
 * @param value - Raw Origin header value, which may be absent.
 * @returns A normalized URL, or null when the header is not a valid browser origin.
 */
export function parseBowOrigin(value: string | null): URL | null {
  if (!value || value === 'null') {
    return null;
  }

  try {
    const origin = new URL(value);
    const isHttp = origin.protocol === 'http:' || origin.protocol === 'https:';
    const hasOriginOnly =
      !origin.username &&
      !origin.password &&
      origin.pathname === '/' &&
      !origin.search &&
      !origin.hash;

    return isHttp && hasOriginOnly ? origin : null;
  } catch {
    return null;
  }
}

/**
 * Checks the published-tenant and loopback development Origin allow-list.
 *
 * @param value - Raw Origin header value, which may be absent.
 * @returns Whether the request may attempt a WebSocket upgrade.
 */
export function isAllowedBowOrigin(value: string | null): boolean {
  const origin = parseBowOrigin(value);

  if (!origin) {
    return false;
  }

  const hostname = origin.hostname.toLowerCase();

  if (LOOPBACK_HOSTS.has(hostname)) {
    return true;
  }

  return origin.protocol === 'https:' && origin.port === '' && isBlitzAppSubdomain(hostname);
}
