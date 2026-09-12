import { resolveBowClientConfig } from './BowClientConfig.js';
import { BowNetSession } from './BowNetSession.js';
import { BowPerformance } from './BowPerformance.js';
import { randomPlayerName, readPlayerName } from './BowPlayerName.js';
import { WebSocketTransport } from './BowTransport.js';
const STYLE_ID = 'kite3d-bow-style';
const LOADING_ID = 'kite3d-bow-loading';
function installStyle(documentOwner) {
    const existingStyle = documentOwner.getElementById(STYLE_ID);
    if (existingStyle) {
        return existingStyle;
    }
    const style = documentOwner.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
    .kite3d-bow-host { position: relative; }
    .kite3d-bow-canvas { display: block; outline: 0; }
    .kite3d-bow-host #${LOADING_ID} {
      position: absolute; inset: 0; display: grid; place-items: center;
      color: #d8dacb; font: 700 12px system-ui, sans-serif; letter-spacing: 3px;
      pointer-events: none; z-index: 20000;
    }
  `;
    documentOwner.head.append(style);
    return style;
}
function installCanvasShell(viewer) {
    const canvas = viewer.canvas;
    const container = viewer.container;
    const documentOwner = canvas.ownerDocument;
    const previousTabIndex = canvas.tabIndex;
    const previousPosition = container.style.position;
    const style = installStyle(documentOwner);
    const focusCanvas = () => canvas.focus();
    const loading = documentOwner.createElement('div');
    loading.id = LOADING_ID;
    loading.role = 'status';
    loading.textContent = 'PREPARING ARENA';
    container.classList.add('kite3d-bow-host');
    canvas.classList.add('kite3d-bow-canvas');
    canvas.tabIndex = 0;
    container.style.position = 'relative';
    canvas.addEventListener('pointerdown', focusCanvas);
    container.querySelector(`#${LOADING_ID}`)?.remove();
    container.append(loading);
    return {
        removeLoading() {
            loading.remove();
        },
        cleanup() {
            loading.remove();
            style.remove();
            canvas.removeEventListener('pointerdown', focusCanvas);
            canvas.tabIndex = previousTabIndex;
            canvas.classList.remove('kite3d-bow-canvas');
            container.classList.remove('kite3d-bow-host');
            container.style.position = previousPosition;
        },
    };
}
/**
 * Creates resources needed synchronously when the component enters Play mode.
 *
 * @param viewer - Active Threepipe viewer and its canvas-scoped container.
 * @param pageUrl - Current page URL, injectable for isolated tests.
 * @returns An idempotent owner for UI, telemetry, optional networking, and cleanup callbacks.
 */
export function createBowBootstrap(viewer, pageUrl = new URL(location.href)) {
    const cleanupCallbacks = [];
    const playerName = readPlayerName() ?? randomPlayerName();
    const clientConfig = resolveBowClientConfig(pageUrl, playerName);
    const performanceStats = new BowPerformance();
    const shell = installCanvasShell(viewer);
    let isCleaned = false;
    let session = null;
    if (clientConfig.socketUrl) {
        session = new BowNetSession(new WebSocketTransport(clientConfig.socketUrl, performanceStats), playerName, performanceStats);
        window.__KITE_BOW_SESSION__ = session;
    }
    window.__KITE_BOW_TELEMETRY__ = performanceStats;
    return {
        mode: clientConfig.mode,
        collisionTestEnabled: pageUrl.searchParams.get('collisionTest') === '1',
        performanceStats,
        session,
        removeLoading() {
            shell.removeLoading();
        },
        addCleanup(callback) {
            cleanupCallbacks.push(callback);
        },
        cleanup() {
            if (isCleaned) {
                return;
            }
            isCleaned = true;
            for (const callback of cleanupCallbacks.reverse()) {
                callback();
            }
            performanceStats.dispose();
            shell.cleanup();
            if (window.__KITE_BOW_SESSION__ === session) {
                delete window.__KITE_BOW_SESSION__;
            }
            if (window.__KITE_BOW_TELEMETRY__ === performanceStats) {
                delete window.__KITE_BOW_TELEMETRY__;
            }
        },
    };
}
