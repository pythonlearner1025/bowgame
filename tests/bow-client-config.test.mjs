/** Specifies published-host defaults, query precedence, and local endpoint overrides. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BOW_WEBSOCKET_ENDPOINT,
  isBlitzAppSubdomain,
  resolveBowClientConfig,
} from '../scripts/BowClientConfig.js';

test('Only real Blitz app subdomains default to online play', () => {
  assert.equal(isBlitzAppSubdomain('bow.app.blitz.dev'), true);
  assert.equal(isBlitzAppSubdomain('nested.bow.app.blitz.dev'), true);
  assert.equal(isBlitzAppSubdomain('app.blitz.dev'), false);
  assert.equal(isBlitzAppSubdomain('bow..app.blitz.dev'), false);
  assert.equal(isBlitzAppSubdomain('app.blitz.dev.evil.example'), false);

  assert.equal(
    resolveBowClientConfig(new URL('https://bow.app.blitz.dev/'), 'Archer').mode,
    'online',
  );
  assert.equal(resolveBowClientConfig(new URL('http://127.0.0.1:43173/'), 'Archer').mode, 'solo');
});

test('Solo wins query precedence and online can be forced on another host', () => {
  const forcedSolo = resolveBowClientConfig(
    new URL('https://bow.app.blitz.dev/?online=1&solo=1'),
    'Archer',
  );
  const forcedOnline = resolveBowClientConfig(new URL('https://example.com/?online=1'), 'Archer');

  assert.equal(forcedSolo.mode, 'solo');
  assert.equal(forcedSolo.socketUrl, null);
  assert.equal(forcedOnline.mode, 'online');
  assert.equal(new URL(forcedOnline.socketUrl).origin, new URL(BOW_WEBSOCKET_ENDPOINT).origin);
});

test('Only loopback pages may override the compatible WebSocket endpoint', () => {
  const local = resolveBowClientConfig(
    new URL('http://[::1]:43173/?online=1&ws=ws%3A%2F%2F127.0.0.1%3A54847%2Fws'),
    'Six & Seven',
  );
  const remote = resolveBowClientConfig(
    new URL('https://example.com/?online=1&ws=ws%3A%2F%2F127.0.0.1%3A54847%2Fws'),
    'Archer',
  );

  assert.equal(local.socketUrl, 'ws://127.0.0.1:54847/ws?room=main&name=Six+%26+Seven');
  assert.equal(new URL(remote.socketUrl).origin, new URL(BOW_WEBSOCKET_ENDPOINT).origin);
});
