/** Installs Kite's post-start validation, telemetry, diagnostics, and frame statistics. */
import { publishGameTelemetry, registerGameValidation } from '@blitzdev/engine';
import { GLStatsJS } from 'threepipe';

/**
 * Completes the active component's post-start integration after its preload promise settles.
 *
 * @param {object} options - Kite application entry-point values.
 * @param {import('threepipe').ThreeViewer} options.viewer - Initialized Threepipe viewer.
 * @returns {Promise<void>} Resolves after diagnostics are installed and the loading marker is gone.
 */
export async function main({ viewer }) {
  window.viewer = viewer;
  const component = window.__KITE_BOW_GAME__;

  if (!component) {
    throw new Error('BowGameComponent did not start before main.js');
  }

  await component.ready;

  if (window.__KITE_BOW_GAME__ !== component) {
    return;
  }

  const unregisterValidation = registerGameValidation(() => component.validateForKite());
  const clearTelemetry = publishGameTelemetry({ ready: true, mode: component.getMode() });
  const stats = new GLStatsJS(viewer.container);
  viewer.renderStats = stats;
  stats.show();
  const panel = viewer.container.querySelector('#stats-js');

  if (panel instanceof HTMLElement) {
    Object.assign(panel.style, { left: '0', right: 'auto', top: '0', zIndex: '20001' });
  }

  component.addHostCleanup(() => {
    unregisterValidation();
    clearTelemetry();
    if (panel?.parentElement) {
      stats.hide();
    }
    if (viewer.renderStats === stats) {
      viewer.renderStats = undefined;
    }
    if (window.viewer === viewer) {
      delete window.viewer;
    }
  });
  component.removeLoading();
  viewer.setDirty();
}
