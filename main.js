export async function main({viewer}) {
    window.viewer = viewer
    console.log('[kite]: Model Root', viewer.scene.modelRoot)
}

export async function onError(error) {
    console.error('[kite]: Error during setup', error)
}
