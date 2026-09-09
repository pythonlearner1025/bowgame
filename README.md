# Timber / Ash bow deathmatch

Standalone Kite3D project for the local bow deathmatch. It uses Threepipe 0.5.1 from the clean checkout at `/private/tmp/kite3d/threepipe`; it does not depend on editor internals or a CDN.

## Setup and run

Build the pinned engine without invoking its optional all-plugin `prepare` build:

```sh
cd /private/tmp/kite3d/threepipe
npm install --ignore-scripts --no-audit --no-fund
npm run compile
```

Install and verify this project:

```sh
cd /private/tmp/bowgame
npm install --ignore-scripts --no-audit --no-fund
npm test
npm run build
npm run preview
```

Open the printed local URL. Click **ENTER ARENA** to enable interaction and audio. The default controls are WASD/arrows, mouse aim, hold/release LMB, RMB steady aim, Shift sprint, Space jump, R restart, Escape pause, and M mute.

Run the deterministic scene check and the headless player smoke test with:

```sh
npm run generate:scene
npm run e2e
```

Playwright is pinned to 1.62.1 because it matches cached Chromium revision 1234. `npm run e2e` uses software WebGL and writes [solo-arena.png](evidence/solo-arena.png) plus [e2e-run.json](evidence/e2e-run.json).

## Open in the Kite3D editor

Start a Kite3D Blueprint Editor compatible with Threepipe 0.5.1, choose **Open project/folder**, and select `/private/tmp/bowgame`. The editor reads `assets/main.scene.glb`, registers `./scripts/BowGameComponent.script.js` from `package.json#kite.scripts`, and exposes the component’s `botCount`, `scoreLimit`, and `difficulty` state. Press Play, then click **ENTER ARENA**.

The authored GLB is intentionally an empty `K3D_BOW_DEMO_ARENA` group with component state. The unchanged seeded arena is created only in play mode and cleaned up on stop; see [SCOPE.md](SCOPE.md) for the rationale and provenance.

## Engine pin

- Package: `threepipe@0.5.1`
- Git commit: `52c3ec1730463d935a582cf999c3eecb0ac63c14`
- Dependency: `file:/private/tmp/kite3d/threepipe`
