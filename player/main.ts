/**
 * Boots the standalone bow player and selects solo or online transport from the current URL.
 */
import { EntityComponentPlugin, ThreeViewer } from 'threepipe';
import { BowGameComponent } from '../scripts/BowGameComponent.script.js';
import { BowNetSession } from '../scripts/BowNetSession.js';
import { randomPlayerName, readPlayerName } from '../scripts/BowPlayerName.js';
import { WebSocketTransport } from '../scripts/BowTransport.js';
import { BowPerformance } from '../scripts/BowPerformance.js';

declare global {
  interface Window {
    viewer: ThreeViewer;
    __KITE_PLAYER__?: { viewer: ThreeViewer; ecp: EntityComponentPlugin; ready: boolean };
    __KITE_BOW_SESSION__?: BowNetSession;
    __KITE_BOW_TELEMETRY__?: BowPerformance;
  }
}

const canvas = document.querySelector<HTMLCanvasElement>('#bow-canvas');

if (!canvas) {
  throw new Error('Bow player canvas is missing');
}

const telemetry = new BowPerformance();
window.__KITE_BOW_TELEMETRY__ = telemetry;

const searchParameters = new URLSearchParams(location.search);
const isOnline =
  searchParameters.get('solo') !== '1' &&
  (searchParameters.get('online') === '1' || location.hostname.endsWith('.workers.dev'));

if (isOnline) {
  const name = readPlayerName() ?? randomPlayerName();
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = `${scheme}://${location.host}/ws?room=main&name=${encodeURIComponent(name)}`;
  window.__KITE_BOW_SESSION__ = new BowNetSession(
    new WebSocketTransport(url, telemetry),
    name,
    telemetry,
  );
}

document.documentElement.dataset.playerMode = isOnline ? 'online' : 'solo';

async function start(): Promise<void> {
  const ecp = new EntityComponentPlugin(false);
  ecp.addComponentType(BowGameComponent);
  const viewer = new ThreeViewer({ canvas, msaa: true, plugins: [ecp] });
  window.viewer = viewer;
  await viewer.load('/kite/assets/main.scene.glb', { autoCenter: false, autoScale: false });
  ecp.start();
  viewer.timeline.start();
  window.__KITE_PLAYER__ = { viewer, ecp, ready: true };
  document.documentElement.dataset.playerReady = 'true';
  document.querySelector('#loading')?.remove();
  viewer.setDirty();
}

void start().catch((error) => {
  const loading = document.querySelector<HTMLElement>('#loading');
  if (loading) {
    loading.textContent = 'ARENA FAILED TO LOAD';
  }
  console.error('[BowPlayer] Failed to initialize', error);
});
