/** Specifies the per-Play canvas shell and idempotent bootstrap cleanup. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installBrowserGlobals, makeViewer } from './helpers/bow-system-harness.mjs';

installBrowserGlobals();
const { createBowBootstrap } = await import('../scripts/BowBootstrap.js');
const { BowGameComponent } = await import('../scripts/BowGameComponent.script.js');

test('Bow bootstrap scopes the loading shell to one viewer and restores it on cleanup', async () => {
  const viewer = await makeViewer();
  viewer.canvas.id = 'kite3d-canvas';
  const host = createBowBootstrap(viewer, new URL('http://127.0.0.1:43173/'));
  let cleanupCalls = 0;
  host.addCleanup(() => cleanupCalls++);

  assert.equal(host.mode, 'solo');
  assert.equal(host.session, null);
  assert.equal(viewer.canvas.tabIndex, 0);
  assert.equal(viewer.container.style.position, 'relative');
  assert.equal(viewer.canvas.classList.contains('kite3d-bow-canvas'), true);
  assert.ok(viewer.container.querySelector('#kite3d-bow-loading'));
  assert.ok(document.getElementById('kite3d-bow-style'));
  host.removeLoading();
  assert.equal(viewer.container.querySelector('#kite3d-bow-loading'), null);

  host.cleanup();
  host.cleanup();
  assert.equal(cleanupCalls, 1);
  assert.equal(viewer.canvas.tabIndex, -1);
  assert.equal(viewer.container.style.position, undefined);
  assert.equal(viewer.canvas.classList.contains('kite3d-bow-canvas'), false);
  assert.equal(document.getElementById('kite3d-bow-style'), null);
});

test('A startup failure before NetworkGlue ownership leaves the online session unopened', async () => {
  const viewer = await makeViewer();
  const component = new BowGameComponent();
  const previousUrl = location.href;
  const previousWebSocket = globalThis.WebSocket;
  const previousConsoleError = console.error;
  const previousSessionDescriptor = Object.getOwnPropertyDescriptor(window, '__KITE_BOW_SESSION__');
  let createdSession = null;
  let webSocketConstructions = 0;
  Object.defineProperty(window, '__KITE_BOW_SESSION__', {
    configurable: true,
    get() {
      return createdSession;
    },
    set(session) {
      createdSession = session;
    },
  });
  globalThis.WebSocket = class {
    static OPEN = 1;

    constructor() {
      webSocketConstructions++;
    }
  };
  location.href = 'https://bow-test.app.blitz.dev/';
  component.ctx = { viewer, ecp: { running: true } };
  component.botCount = 0;
  console.error = () => {};

  try {
    component.start();

    await assert.rejects(component.ready, /botCount must be an integer/);
    assert.ok(createdSession);
    assert.equal(createdSession.snapshot().status, 'disconnected');
    assert.equal(webSocketConstructions, 0);
    assert.equal(window.__KITE_BOW_SESSION__, undefined);
    assert.equal(document.getElementById('kite3d-bow-style'), null);
  } finally {
    component.stop();
    console.error = previousConsoleError;
    location.href = previousUrl;
    globalThis.WebSocket = previousWebSocket;
    if (previousSessionDescriptor) {
      Object.defineProperty(window, '__KITE_BOW_SESSION__', previousSessionDescriptor);
    } else {
      delete window.__KITE_BOW_SESSION__;
    }
  }
});
