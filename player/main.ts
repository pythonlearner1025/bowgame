/**
 * Boots the standalone bow player and selects solo or online transport from the current URL.
 */
import { EntityComponentPlugin, GLStatsJS, ThreeViewer } from 'threepipe';
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

/**
 * Shows threepipe's stats.js panel in the top-left corner.
 *
 * The viewer's animation loop already calls `renderStats.begin()` and `end()` once per loop, so
 * assigning the panel reuses that timing without `debug: true`, which also rethrows plugin errors.
 *
 * @param viewer - Viewer whose animation loop drives the panel.
 */
function showFrameStats(viewer: ThreeViewer): void {
  const stats = new GLStatsJS(viewer.container);
  viewer.renderStats = stats;
  stats.show();
  const panel = viewer.container.querySelector<HTMLElement>('#stats-js');

  if (panel) {
    // GLStatsJS pins the panel top-right, where the HUD standings sit.
    Object.assign(panel.style, { left: '0', right: 'auto', top: '0', zIndex: '20001' });
  }
}

async function start(): Promise<void> {
  const ecp = new EntityComponentPlugin(false);
  ecp.addComponentType(BowGameComponent);
  // The 4-sample MSAA target was the largest per-frame GPU cost, so the player renders without it.
  const viewer = new ThreeViewer({ canvas, msaa: false, plugins: [ecp] });
  window.viewer = viewer;
  showFrameStats(viewer);
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
