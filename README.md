# Timber / Ash bow deathmatch

Standalone Kite3D project for the local bow deathmatch. It uses Threepipe 0.5.1 from the clean checkout at `/private/tmp/kite3d/threepipe`; it does not depend on editor internals or a CDN.

## Code style

Read [CODESTYLE.md](CODESTYLE.md) before changing source. Formatting and linting are enforced by
`npm run lint`; use `npm run format` or `npm run lint:fix` to apply mechanical fixes. Enable the
committed pre-commit check once per clone:

```sh
git config core.hooksPath .githooks
```

## Play online

The deployed game is **https://bowgame.minjunesv0.workers.dev**. The hosted page joins the one `main` room automatically; edit the generated `Archer-####` name on the **ENTER ARENA** overlay, then enter. Up to 10 friends can play, the first player to 20 kills wins, and the next round starts about five seconds later. Add `?solo=1` to the live URL to force the original three-bot, first-to-10 game.

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

## Diagnose flicker or lag

Client diagnostics are always collected locally in a bounded, roughly five-minute ring buffer; no gameplay payloads are stored. Press **F8** to show or hide the compact debug overlay. Press **F9** to download the buffer as `bowgame-telemetry-<timestamp>.json`. Browser automation can read the same data with `window.__KITE_BOW_TELEMETRY__.exportData()`.

Each `samples[]` entry covers about one second and contains:

- `at`, `windowMs`, `visible`, and `activeFrames`;
- `frameTimeMs` and `gameCpuMs` (`count`, `p50`, `p95`, `max`), plus `renders`;
- timestamped `rAFGaps` over 100 ms and `longTasks` from `PerformanceObserver` (useful for GC-like or other main-thread stalls);
- `rttMs`, and `network.inbound` / `network.outbound` message counts and UTF-8 bytes, including `byType` totals;
- timestamped `reconnects` and `socketCloses` (`code`, `wasClean`);
- current `canvas` metrics and `canvasChanges` for backing/client size, device and renderer pixel ratios, and render scale;
- `remoteStateStaleness.players` and `maxMs`, measuring time since the last state frame from each remote player.

The `BowRoom` Worker writes JSON-only metadata to Workers Logs and never logs WebSocket payloads. Every line includes `service`, `event`, and `timestamp`.

| `event`            | Additional fields                                                                                                                        |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `hibernation_wake` | `connectedCount`                                                                                                                         |
| `join`             | `playerId`, `slot`, `connectedCount`                                                                                                     |
| `leave`            | `playerId`, `slot`, `code`, `wasClean`, `connectedCount`                                                                                 |
| `full`             | `connectedCount`, `roomCap`                                                                                                              |
| `round_end`        | `round`, `winnerId`, `connectedCount`                                                                                                    |
| `round_reset`      | `round`, `connectedCount`                                                                                                                |
| `exception`        | `handler`, `errorName`, `errorMessage`, `connectedCount`                                                                                 |
| `summary`          | `windowStartedAt`, `windowMs`, `inboundMessagesByType`, `outboundMessagesByType`, `broadcastFanOut`, `maxMessageBytes`, `connectedCount` |

The hibernation-friendly 60-second summary is emitted on the first room activity after each minute; an idle room does not stay awake just to log.

Run the deterministic scene check and the headless player smoke test with:

```sh
npm run generate:scene
npm run e2e
```

Playwright is pinned to 1.62.1 because it matches cached Chromium revision 1234. `npm run e2e` uses software WebGL and writes [solo-arena.png](evidence/solo-arena.png) plus [e2e-run.json](evidence/e2e-run.json).

## Run online locally

Build the static player, then run the Worker and SQLite-backed Durable Object locally:

```sh
npm run build
npx wrangler dev
```

Open `http://localhost:8787/?online=1`. Use `?solo=1` to force solo mode. The full online test chooses a free port, starts and stops `wrangler dev`, opens two cached headless Chromium pages, and also probes the 10-player cap and round reset:

```sh
npm run e2e:online
```

Run the local Metal-first consecutive-frame probe (with automatic SwiftShader fallback) with:

```sh
npm run probe:flicker
```

It writes `evidence/flicker-local.json` / `.png` by default. Set `BOWGAME_FLICKER_LABEL=<label>` to select another evidence label; the checked-in investigation baselines use `before` and `after`.

To deploy the static build and room relay to the configured Cloudflare account:

```sh
npm run build
npx wrangler deploy
```

## Open in the Kite3D editor

Start a Kite3D Blueprint Editor compatible with Threepipe 0.5.1, choose **Open project/folder**, and select `/private/tmp/bowgame`. The editor reads `assets/main.scene.glb`, registers `./scripts/BowGameComponent.script.js` from `package.json#kite.scripts`, and exposes the component’s `botCount`, `scoreLimit`, and `difficulty` state. Press Play, then click **ENTER ARENA**.

The authored GLB is intentionally an empty `K3D_BOW_DEMO_ARENA` group with component state. The unchanged seeded arena is created only in play mode and cleaned up on stop; see [SCOPE.md](SCOPE.md) for the rationale and provenance.

## Engine pin

- Package: `threepipe@0.5.1`
- Git commit: `52c3ec1730463d935a582cf999c3eecb0ac63c14`
- Dependency: `file:/private/tmp/kite3d/threepipe`
