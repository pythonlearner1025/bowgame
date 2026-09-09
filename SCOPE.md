# Scope and provenance

## What this repository is

This is a standalone Kite3D project containing the Timber / Ash local bot bow deathmatch. It was ported from `/Users/minjunes/Documents/ChatGPT/kite3d/upstream/packages/threepipe-blueprint-editor` and uses only public project/browser APIs from clean `threepipe@0.5.1`, commit `52c3ec1730463d935a582cf999c3eecb0ac63c14`.

The 12 original `Bow*.ts` modules were copied to `src/`; `BowGameComponent.script.ts` is the project lifecycle adapter. The six modules that remain source-byte-identical are `BowArena.ts`, `BowArrowTrail.ts`, `BowPhysics.ts`, `BowReferenceClip.ts`, `BowSceneBatch.ts`, and `BowVisuals.ts`. In `BowAudio.ts`, `BowHumanAsset.ts`, `BowHandPose.ts`, and `BowHandRig.ts`, only project asset paths and browser `.js` import suffixes changed. `BowPerformance.ts` retains telemetry but no longer disables the renderer’s required `info.autoReset` flag. `BowGameRuntime.ts` contains the lifecycle/host refactor described below; its gameplay and tuning constants are unchanged.

## Structural changes from the editor implementation

- Removed `ViewerInstanceManager`, play-mode helper state, root-scene metadata selection, handler construction, and the private runtime RAF.
- Added `BowGameComponent extends Object3DComponent` with serialized defaults `botCount=3`, `scoreLimit=10`, and `difficulty=normal`.
- Mapped component `start`, `stop`, `destroy`, and `update({deltaTime})` to runtime setup/cleanup and the existing 120 Hz accumulator.
- Replaced editor asset URLs with `/kite/assets/...`; recorded-audio caching/decoding/playback behavior is otherwise unchanged.
- Added cancellation-safe async startup and complete runtime arena/listener/DOM/audio/render/camera cleanup for stop/HMR.
- Kept Escape behavior after a real pointer lock. If initial pointer lock is unavailable, play continues with the existing drag-to-aim path and an on-screen notice.
- Compiled TypeScript into committed raw ES modules in `scripts/`; relative imports end in `.js`, and `threepipe` is the only bare import.
- Added a local Vite player that registers `BowGameComponent` before loading the GLB and starts both `EntityComponentPlugin` and the viewer timeline.
- Adapted only the filesystem/viewer harness portions of the 45 original tests; their assertions and count remain intact.

No multiplayer, networking, new gameplay, re-tuning, content replacement, or engine/editor source edit is included.

## Scene strategy and visible equivalence

`assets/main.scene.glb` is the documented fallback: a 396-byte GLB holding one empty authored group, `K3D_BOW_DEMO_ARENA`, with serialized component state and a runtime-only marker. Baking the procedural instanced arena would make GLB round-tripping lossy and duplicate large generated content. At component start, the verbatim `buildBowArena()` runs from the same initial seed `73429`; its group is marked `K3D_BOW_RUNTIME_ARENA` and disposed on stop.

The browser evidence records 134 arena objects, 133 meshes, four instanced meshes, 6,720 needle boughs, 1,680 branches, 3,400 grasses, and 160 pebbles. Runtime batching saw 91 original meshes and made 28 batches. See [e2e-run.json](evidence/e2e-run.json) and the real rendered capture [solo-arena.png](evidence/solo-arena.png).

## Byte-identical copied assets

Each file below was compared with `cmp` against the original and re-hashed in this repository.

| Asset | SHA-256 |
|---|---|
| `bow-audio/LICENSES.md` | `29136a39d03d3ca48a8cb578e3e86926b3706ebe11217edcce4725ca74dd5df5` |
| `bow-audio/PROVENANCE.json` | `f26f763b9611cfc60f800dafb044e1d9f2446e98e813632b0272568a0830e547` |
| `bow-audio/PROVENANCE.md` | `6c79c6dc801591c1f26baf7ecedce6fa6da469f1566f5adb6a814cdb1591d1fd` |
| `bow-audio/processing-waveforms.png` | `52b0b89a2ea7370da42cc20ba1d6a170ddc24ae3da7310f6cb3fa86a24f3553b` |
| `bow-audio/release-recorded.wav` | `2cc39db46946086deebd40cba00d5c4556812483a56eb28f0cc59fa093918ab2` |
| `bow-audio/whizz-recorded.wav` | `b50eda446b72cecb6ecbd82c0007c9e344a3656fc925b7ccd2cd4dda24797951` |
| `bow-survivor/LICENSE.CC0.md` | `f6089cba01cb570a24712b41ab8a586ccd3cc5ef53dc266ca50b95c288956d2c` |
| `bow-survivor/PROVENANCE.md` | `76dcfcbd27f712c6603099821e8c8bfd85bc907ad5d34ac4d5fd629d08fc37be` |
| `bow-survivor/eyes-brown.png` | `4659691c7295ad6206c78b003e5fd0e5f91dcd53032fa914a229bb48cabe424b` |
| `bow-survivor/male-adult-rigged.json` | `67d4d6fa8e134f0e703182954b817b99ff52f592225a3818b12613a44a1f1951` |
| `bow-survivor/skin-male.png` | `03efe1f6b0ae52429649dcefc9dcaef6058032f874a251169cc3e2ed473c3874` |

The provenance documents and processing image remain in the project but are not shipped by the hosted player because they are not runtime inputs. This also keeps historical source URLs out of `dist/`.

## Known limitations

- The editor’s stopped/edit view shows the empty component group; the arena appears in play mode.
- Headless Chromium cannot acquire pointer lock on this machine, so E2E verifies the graceful drag-to-aim fallback. Normal browsers retain pointer-lock/escape behavior.
- Software WebGL advances fewer simulation seconds than wall-clock seconds; the E2E assertion checks actual accumulated simulation time and bot displacement.
- Clean Threepipe reports draw/triangle counters per its public post-render state; the old cross-pass `autoReset=false` profiling technique is incompatible with 0.5.1.
- The project dependency is intentionally pinned to an absolute clean-checkout path for this requested environment.

## Multiplayer slice

This repository now adds one deliberately narrow online mode around the standalone game. The same `player/main.ts` entrypoint chooses online mode on `*.workers.dev` or with `?online=1`; `?solo=1` always selects the unchanged bot mode. Online mode uses one Cloudflare Worker for the static `dist/` build and `/ws`, plus one SQLite-backed `BowRoom` Durable Object instance named `main`. There is no second backend.

`BowTransport.ts` is the small `connect` / `send` / `onMessage` / `close` boundary, with `WebSocketTransport` as its first implementation. `BowNetSession.ts` owns the local player slot, remote slots keyed by player ID, scores, round, connection state, heartbeat, RTT, and reconnect backoff. `BowGameRuntime` consumes that session independently of the transport. Remote slots render the existing `BowHumanAsset`/`BowVisuals` human and bow rig, interpolate the relayed transform/draw animation, and never run bot AI. Online bots are disabled because unsynchronized local AI would create different opponents and scores for every client.

### Version 1 protocol

Every frame is JSON text with `v: 1`. State is sent at 20 Hz; ping runs every 20 seconds.

| Direction | Message | Payload / behavior |
|---|---|---|
| client → server | `join` | `name`; changes the attachment-backed display name. |
| client → server | `state` | `seq`, `pos`, `yaw`, `pitch`, `draw`, `anim`; relayed to peers. |
| client → server | `shot` | `arrowId`, `origin`, `velocity`; peers spawn a visual-only ballistic arrow and trail. |
| client → server | `hit` | `targetId`, `arrowId`, `damage`, `head`; relayed to the victim. |
| client → server | `death` | `killerId`; the only message that changes the Durable Object kill tally. |
| client → server | `ping` | `sentAt`; echoed as `pong` for RTT. |
| server → client | `welcome` | `playerId`, ordered `roster` slots, `scores`, `scoreLimit: 20`, `round`. |
| server → client | `join`, `leave` | Adds, renames, or removes a player slot. |
| server → client | `state`, `shot`, `hit` | Relayed sender data with a server-supplied `playerId`. |
| server → client | `death`, `scores` | Announces the victim/killer and the authoritative round kill map. |
| server → client | `round_end` | `winnerId`, `scores` when a player reaches 20 kills. |
| server → client | `round_reset` | New `round` after about five seconds; clients restore health, respawn, and clear arrows. |
| server → client | `full` | Rejects an 11th connection; the client offers a solo-mode button. |
| server → client | `pong` | Echoed `sentAt` used to display latency as RTT. |

### Trust model and limits

Health is victim-authoritative. A shooter simulates its own arrow with the existing gravity, swept collision, cover, and head/body capsules, then reports `hit`. The target applies the reported damage locally; on death it reports `death{killerId}` and follows the existing automatic respawn timing. The Durable Object never simulates shots or validates aim, damage, position, fire rate, or deaths. Friends can therefore cheat by sending fabricated state, hits, or deaths, modifying damage, teleporting, or suppressing their own death report. This is intentional for the trusted-friends slice and is not safe for competitive or public play.

The deployed service has one room, at most 10 concurrent players, a fixed 20-kill round, no accounts, no matchmaking, no persistence, no server authority, no lag compensation, no chat, and no bots online. Scores and connection attachments exist only for live sockets; a deployment, runtime shutdown, or empty room can discard them. The HUD's latency number is WebSocket round-trip time, not one-way latency. Hibernation attachments restore live socket identity/name/score after a Durable Object wake, and a Durable Object alarm performs the delayed round reset.

SQLite-backed Durable Objects are available on Cloudflare's Workers Free plan. Normal Workers, Durable Object request/duration, storage, and static-asset allowances still apply, can change, and should be checked against Cloudflare's current pricing before broader use. This slice writes no score or account records; SQLite class selection is used to make the Durable Object eligible for the Free plan, while storage is used only for its reset alarm.

### Operations

Build and deploy from `/private/tmp/bowgame` with `npm run build && npx wrangler deploy`. The current live route is `https://bowgame.minjunesv0.workers.dev`. Roll back to the preceding deployment with `npx wrangler rollback`; in an emergency, remove the Worker and its route with `npx wrangler delete`. These commands affect the configured account `53a144fad4e15ca51c32da9b9fe25d4a`.

The player cap and score limit are centralized as `BOW_ROOM_CAP` and `BOW_SCORE_LIMIT` in `src/BowProtocol.ts`; change them there, run `npm test`, `npm run e2e:online`, rebuild, and deploy. `wrangler.jsonc` pins the Worker name, account, static assets, `BOW_ROOM` binding, SQLite migration, current compatibility date, and observability.
