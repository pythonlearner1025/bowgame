# Bow Deathmatch

Bow Deathmatch is a published-Kite3D project with a three-bot solo mode and a separate online
WebSocket room service. Kite3D 0.13.2 is the only page runtime: there is no Vite player and the
Cloudflare Worker does not serve static files.

## Development

Read [CODESTYLE.md](CODESTYLE.md) before changing source. TypeScript in `src/` is compiled to
committed ES modules in `scripts/`; never edit the generated JavaScript directly. Enable the
repository hook once per clone so commits reject stale generated output:

```sh
git config core.hooksPath .githooks
```

Install the pinned packages and run the local gates:

```sh
npm ci
npm test
npm run check
npm run doctor
npm run build
npm run e2e
```

`npm run check` runs Kite3D's headless Playable, Editable, and Persisted checks. `npm run build`
creates an audited release fixture in `.kite3d/e2e-release`; it does not publish or create a Vite
`dist/` directory. Preview that fixture with `npm run preview:release`.

The manifest requests render scale 1 with MSAA disabled. Hardware renderers retain the runtime's
1.1 maximum and directional shadows. SwiftShader, llvmpipe, softpipe, lavapipe, and renderer
names containing `software` use half scale without the 2048-pixel sun-shadow pass. A browser that
hides renderer information takes the hardware path.

Start the Kite3D editor without opening a browser automatically:

```sh
npm run dev -- --no-open
```

The authored `assets/main.scene.gltf` and `assets/main.scene.bin` contain the component and a
small stopped-mode preview. Press Play to replace the preview with the procedural arena; Stop
removes the runtime-owned tree and restores the preview. Regenerate the scene with
`npm run generate:scene`.

The controls are WASD/arrows, mouse aim, hold/release LMB to shoot, RMB to steady aim, Shift to
sprint, Space to jump, R to restart, Escape to pause, and M to mute. Click **ENTER ARENA** before
playing so the canvas can receive input and audio permission.

## Online mode

Published pages on a real subdomain of `app.blitz.dev` join online mode by default. Every other
host defaults to solo, which keeps Kite3D checks and ordinary local tests independent of a
socket. Query parameters apply in this order:

- `?solo=1` always selects solo mode.
- `?online=1` selects online mode on other hosts.
- `?ws=ws://...` or `?ws=wss://...` overrides the endpoint only when the page itself is on
  `localhost`, `127.0.0.1`, or `[::1]`.

The configured production endpoint is `wss://bowgame.minjunesv0.workers.dev/ws`. The client
preserves the existing `room=main` and `name=<player>` connection query and version-1 JSON
protocol. Online rooms allow 10 players and use a 20-kill score limit; online mode has no bots.

The Worker accepts only `/ws`, then requires an allowed `Origin`, then requires a WebSocket
upgrade. Allowed origins are HTTPS tenant subdomains below `app.blitz.dev` and HTTP/HTTPS
loopback origins on any valid port. Missing, `null`, malformed, non-HTTP(S), bare
`app.blitz.dev`, and lookalike suffix origins are rejected.

Run the complete local release-plus-Worker integration with:

```sh
npm run e2e:online
```

For manual testing, start `npm run preview:release` and `npx wrangler dev` in separate terminals,
then open the release URL with `?online=1&ws=ws://127.0.0.1:8787/ws`. The automated runner
chooses free ports and stops both processes.

## Diagnostics

Press F8 to toggle the bounded client diagnostics overlay and F9 to download its roughly
five-minute telemetry buffer. Browser automation can read the same data from
`window.__KITE_BOW_TELEMETRY__.exportData()`. The buffer records frame/game CPU distributions,
render counts, long tasks, canvas changes, network counts and RTT, reconnects, socket closes,
and remote-state staleness. It stores no gameplay payloads.

The `GLStatsJS` panel in the top-left displays FPS, viewer-loop milliseconds, or memory. The room
Worker emits payload-free structured events and a hibernation-friendly activity summary.

Run the consecutive-frame browser probe with:

```sh
npm run probe:flicker
```

It refreshes `evidence/flicker-after.json` and `.png` by default. Set
`BOWGAME_FLICKER_LABEL=<label>` to choose a different evidence label.

`npm run export:scene` writes an uncommitted, self-contained procedural arena to
`evidence/bow-arena.gltf` for external inspection.

## Packages and release boundaries

Kite supplies `three` and `threepipe` at runtime. Their exact packages, Kite3D, the engine,
Playwright, and `three-mesh-bvh` are development dependencies because publishing strips
development dependencies. The BVH browser module is vendored at a pinned hash under `vendor/`
so release imports remain local. Runtime asset URLs are module-relative; `/kite3d/` is used only
by Kite's loader.

There are two independent outward operations, and neither is part of build or test:

```sh
npm run publish        # publish the Kite client
npm run deploy:worker  # deploy the Cloudflare WebSocket service
```

Run either only as an explicit release action. Publishing the Kite project never deploys the
Worker. See [SCOPE.md](SCOPE.md) for architecture, protocol, trust limits, and asset provenance.
