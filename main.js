/** Exposes Kite's viewer for diagnostics without owning the playable bow runtime. */

/**
 * Publishes the initialized viewer for the Kite host's inspection tools.
 *
 * @param {object} options - Kite application entry-point values.
 * @param {import('threepipe').ThreeViewer} options.viewer - Initialized Threepipe viewer.
 */
export async function main({ viewer }) {
  window.viewer = viewer;
  console.log('[kite]: Model Root', viewer.scene.modelRoot);
}

/**
 * Reports setup failures with the Kite entry-point context.
 *
 * @param {unknown} error - Setup error supplied by the host.
 */
export async function onError(error) {
  console.error('[kite]: Error during setup', error);
}
