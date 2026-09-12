# Scope and provenance

## What this repository is

This is a published-Kite3D 0.13.2 project containing the BOWGAME bow deathmatch. It uses
only public project/browser APIs from `threepipe@0.5.1` and `@blitzdev/engine@0.13.2`. The page
runtime is Kite3D; the Cloudflare Worker is a separately deployed WebSocket-only room service.

The 12 original `Bow*.ts` modules were copied to `src/`; `BowGameComponent.script.ts` is the
project lifecycle adapter. On 2026-09-09, every authored TypeScript and JavaScript module was
reformatted, documented, and expanded for human readability under `CODESTYLE.md`. The rewrite
deliberately preserves gameplay tuning and public behavior; the full unit, browser, and online
suites verify that contract. Asset provenance is tracked separately below, and the committed
runtime assets retain their recorded hashes.

## Structural changes from the editor implementation

- Removed `ViewerInstanceManager`, play-mode helper state, handler construction, the private
  runtime RAF, and the standalone Vite player.
- Added `BowGameComponent extends Object3DComponent` with serialized defaults `botCount=3`,
  `scoreLimit=10`, and `difficulty=normal`.
- Mapped component `start`, `stop`, `destroy`, and `update({deltaTime})` to runtime setup/cleanup
  and the existing 120 Hz accumulator.
- Replaced root-relative asset URLs with module-relative URLs for project-owned literals.
  Recorded-audio caching/decoding/playback behavior is otherwise unchanged.
- Added cancellation-safe async startup and complete runtime arena/listener/DOM/audio/render/
  camera cleanup for stop and hot reload.
- Kept Escape behavior after a real pointer lock. If initial pointer lock is unavailable, play continues with the existing drag-to-aim path and an on-screen notice.
- Compiled TypeScript into committed raw ES modules in `scripts/`; relative imports end in `.js`,
  bare imports are limited to Kite-provided modules, and `three-mesh-bvh` is a pinned local
  browser artifact.
- Added one `RuntimeObjectOwner` tree outside `modelRoot`, Kite validation/telemetry hooks, and a
  minimal post-start `main.js` integration.
- Preserved the gameplay and protocol suite while adapting filesystem/viewer fixtures for the
  published runtime.

The initial port excluded multiplayer and gameplay changes. Subsequent multiplayer and collision changes are documented below; engine/editor source remains unmodified.

## Scene strategy and visible equivalence

`assets/main.scene.gltf` and `assets/main.scene.bin` are deterministic authored sources. They hold
a real scene-model root, stable component metadata, and a two-mesh stopped preview. Baking the
procedural instanced arena would make scene round-tripping lossy and duplicate large generated
content. At component start, the preview is hidden and seeded `buildBowArena()` runs from seed
`73429` beneath `K3D_BOW_RUNTIME`; Stop disposes that owned tree and restores the preview.

The browser evidence records 135 arena objects, 134 meshes, four instanced meshes, 6,720 needle boughs, 1,680 branches, 3,400 grasses, and 160 pebbles. Runtime batching saw 91 original meshes and made 28 batches. See [e2e-run.json](evidence/e2e-run.json) and the real rendered capture [solo-arena.png](evidence/solo-arena.png).

## Byte-identical copied assets

Each file below was compared with `cmp` against the original and re-hashed in this repository.

| Asset                                 | SHA-256                                                            |
| ------------------------------------- | ------------------------------------------------------------------ |
| `bow-audio/LICENSES.md`               | `29136a39d03d3ca48a8cb578e3e86926b3706ebe11217edcce4725ca74dd5df5` |
| `bow-audio/PROVENANCE.json`           | `f26f763b9611cfc60f800dafb044e1d9f2446e98e813632b0272568a0830e547` |
| `bow-audio/PROVENANCE.md`             | `6c79c6dc801591c1f26baf7ecedce6fa6da469f1566f5adb6a814cdb1591d1fd` |
| `bow-audio/processing-waveforms.png`  | `52b0b89a2ea7370da42cc20ba1d6a170ddc24ae3da7310f6cb3fa86a24f3553b` |
| `bow-audio/release-recorded.wav`      | `2cc39db46946086deebd40cba00d5c4556812483a56eb28f0cc59fa093918ab2` |
| `bow-audio/whizz-recorded.wav`        | `b50eda446b72cecb6ecbd82c0007c9e344a3656fc925b7ccd2cd4dda24797951` |
| `bow-survivor/LICENSE.CC0.md`         | `f6089cba01cb570a24712b41ab8a586ccd3cc5ef53dc266ca50b95c288956d2c` |
| `bow-survivor/PROVENANCE.md`          | `76dcfcbd27f712c6603099821e8c8bfd85bc907ad5d34ac4d5fd629d08fc37be` |
| `bow-survivor/eyes-brown.png`         | `4659691c7295ad6206c78b003e5fd0e5f91dcd53032fa914a229bb48cabe424b` |
| `bow-survivor/male-adult-rigged.json` | `67d4d6fa8e134f0e703182954b817b99ff52f592225a3818b12613a44a1f1951` |
| `bow-survivor/skin-male.png`          | `03efe1f6b0ae52429649dcefc9dcaef6058032f874a251169cc3e2ed473c3874` |

The provenance documents and processing image remain in the project. The Kite publish exclude
rules omit non-runtime sources and evidence from the release.

## Known limitations

- The editor's stopped/edit view shows a small representative preview; the full arena appears in
  play mode.
- Headless Chromium cannot acquire pointer lock on this machine, so E2E verifies the graceful drag-to-aim fallback. Normal browsers retain pointer-lock/escape behavior.
- Software WebGL advances fewer simulation seconds than wall-clock seconds; the E2E assertion checks actual accumulated simulation time and bot displacement.
- Clean Threepipe reports draw/triangle counters per its public post-render state; the old cross-pass `autoReset=false` profiling technique is incompatible with 0.5.1.
- A local release fixture can prove file/import/runtime parity, but private hosted gateway headers
  and CSP still require an explicitly authorized published smoke test.
- Kite's headless browser reports SwiftShader on this machine. Hardware keeps the configured
  render scale and directional shadow; recognized software rendering uses half scale without that
  shadow pass to satisfy Kite's fixed 30-frame validation budget without a checker-specific code
  path. A browser that hides renderer information takes the hardware path.

## Multiplayer slice

This repository has one deliberately narrow online mode around the standalone game. A real
subdomain of `app.blitz.dev` defaults online; other hosts default solo, `?online=1` opts in, and
`?solo=1` always wins. Only a loopback page may use a validated `?ws=` override. The Kite page
connects to the separately deployed WebSocket-only Worker at
`wss://bowgame.minjunesv0.workers.dev/ws` and selects the `main` room. The Worker accepts bounded
named rooms, each backed by its own SQLite `BowRoom` Durable Object instance.

`BowTransport.ts` is the small `connect` / `send` / `onMessage` / `close` boundary, with `WebSocketTransport` as its first implementation. `BowNetSession.ts` owns the local player slot, remote slots keyed by player ID, scores, round, connection state, heartbeat, RTT, and reconnect backoff. `BowGameRuntime` consumes that session independently of the transport. Remote slots render the existing `BowHumanAsset`/`BowVisuals` human and bow rig, interpolate the relayed transform/draw animation, and never run bot AI. Online bots are disabled because unsynchronized local AI would create different opponents and scores for every client.

### Version 1 protocol

Every frame is JSON text with `v: 1`. State is sent at 20 Hz; ping runs every 20 seconds.

| Direction       | Message                | Payload / behavior                                                                       |
| --------------- | ---------------------- | ---------------------------------------------------------------------------------------- |
| client → server | `join`                 | `name`; changes the attachment-backed display name.                                      |
| client → server | `state`                | `seq`, `pos`, `yaw`, `pitch`, `draw`, `anim`; relayed to peers.                          |
| client → server | `shot`                 | `arrowId`, `origin`, `velocity`; peers spawn a visual-only ballistic arrow and trail.    |
| client → server | `hit`                  | `targetId`, `arrowId`, `damage`, `head`; relayed to the victim.                          |
| client → server | `death`                | `killerId`; the only message that changes the Durable Object kill tally.                 |
| client → server | `ping`                 | `sentAt`; echoed as `pong` for RTT.                                                      |
| server → client | `welcome`              | `playerId`, ordered `roster` slots, `scores`, `scoreLimit: 20`, `round`.                 |
| server → client | `join`, `leave`        | Adds, renames, or removes a player slot.                                                 |
| server → client | `state`, `shot`, `hit` | Relayed sender data with a server-supplied `playerId`.                                   |
| server → client | `death`, `scores`      | Announces the victim/killer and the authoritative round kill map.                        |
| server → client | `round_end`            | `winnerId`, `scores` when a player reaches 20 kills.                                     |
| server → client | `round_reset`          | New `round` after about five seconds; clients restore health, respawn, and clear arrows. |
| server → client | `full`                 | Rejects an 11th connection; the client offers a solo-mode button.                        |
| server → client | `pong`                 | Echoed `sentAt` used to display latency as RTT.                                          |

### Trust model and limits

Health is victim-authoritative. A shooter simulates its own arrow with the existing gravity, swept collision, cover, and head/body capsules, then reports `hit`. The target applies the reported damage locally; on death it reports `death{killerId}` and follows the existing automatic respawn timing. The Durable Object never simulates shots or validates aim, damage, position, fire rate, or deaths. Friends can therefore cheat by sending fabricated state, hits, or deaths, modifying damage, teleporting, or suppressing their own death report. This is intentional for the trusted-friends slice and is not safe for competitive or public play.

The Worker accepts bounded named rooms; the production client selects `main`. Each room allows at most 10 concurrent players and has a fixed 20-kill round, no accounts, no matchmaking, no persistence, no server authority, no lag compensation, no chat, and no bots online. Scores and connection attachments exist only for live sockets; a deployment, runtime shutdown, or empty room can discard them. The HUD's latency number is WebSocket round-trip time, not one-way latency. Hibernation attachments restore live socket identity/name/score after a Durable Object wake, and a Durable Object alarm performs the delayed round reset.

SQLite-backed Durable Objects are available on Cloudflare's Workers Free plan. Normal Workers, Durable Object request/duration, storage, and static-asset allowances still apply, can change, and should be checked against Cloudflare's current pricing before broader use. This slice writes no score or account records; SQLite class selection is used to make the Durable Object eligible for the Free plan, while storage is used only for its reset alarm.

### Operations

`npm run publish` publishes the Kite client. `npm run deploy:worker` deploys the independent
WebSocket service. Neither command is part of build or verification, and both require an
explicit release action. `wrangler.jsonc` pins the Worker name, `BOW_ROOM` binding, SQLite
migration, compatibility date, `workers_dev`, and observability; it has no static-assets binding.

The Worker returns 404 outside `/ws`, rejects disallowed or absent origins with 403, and returns
426 when an allowed `/ws` request is not a WebSocket upgrade. It permits HTTPS origins whose
host is a nonempty tenant below `app.blitz.dev`, plus HTTP/HTTPS loopback origins on any valid
port. The player cap and score limit remain centralized as `BOW_ROOM_CAP` and
`BOW_SCORE_LIMIT` in `src/BowProtocol.ts`.

## Changelog

### 2026-09-09 — boundary barrier and scene export

An invisible boundary barrier now rings the play area at the original 27 m radius. It is 40 m tall with 96 wall segments and carries a player-barrier marker instead of the solid marker. Player and bot capsules cannot cross it. Arrows, bot sight lines, and spawn support ignore it, so no arrow can stick to an invisible surface. It is not rendered and not batched. The climbable outer boulders therefore stay inside the arena and cannot be used to leave it. Collision statistics now report `barrierTriangles` (192 for this arena). The 129 solid meshes and 89,056 solid triangles are unchanged.

`npm run export:scene` writes the seeded arena to `evidence/bow-arena.gltf` as one self-contained glTF 2.0 JSON file: embedded buffers, plain colored materials in place of the procedural canvas textures, and `EXT_mesh_gpu_instancing` for the four instanced meshes. The invisible barrier is not exported. The file is regenerated on demand and is not committed.

### 2026-09-09 — solid surfaces and parkour (requested gameplay change)

Solid objects now collide as they look. Arrows stick to the visible triangles of rocks, boulders, walls, crates, shelter posts and roof, barricade planks, fallen timber, and tree trunks. The player and solo bots use the same static mesh collider; players can jump onto supported tops, stand there, slide along walls, and fall when walking off an edge. Foliage boughs and branches, grass, and pebbles stay walk-through. The old invisible 27 m movement boundary is gone. The visible floor at y=-0.04 now determines foot height; eye offset, movement/sprint/draw speeds, jump impulse, controls, and shot hit volumes are unchanged.

One `three-mesh-bvh@0.9.5` tree contains 89,056 world-space triangles from 129 solid mesh instances, built before render batching hides source meshes. The final full Node run built it in **46.46 ms**; the cached Chromium solo run took **40.90 ms**, including geometry collection and BVH construction. A 1,200-step Node benchmark resolving four capsules per step measured **0.0505 ms p50 / 0.0561 ms p95 / 1.0857 ms max**. Browser capsule resolution averaged **0.00828 ms per capsule call**, maximum **0.20 ms** in that sample. These are collision CPU costs, not total frame or GPU times.

Spawn locations are checked against mesh surfaces and nudged to the nearest sampled supported position when blocked (25 cm search rings). For this arena, online slot 5 moves from its blocked original position to approximately `(3.763, -0.0399, -25.763)`. The zero-thickness shelter tarp supports landing but does not make the space beneath it a filled volume. Bots choose a temporary new destination after less than 20 cm displacement over 1.5 seconds; their aiming and difficulty tuning are unchanged.

Validation now includes 67 Node tests, including reference triangle raycasts, rock blocking, crate landing/edge falls, spawn clearance, instancing, steep slopes, nearest world/player hits, and visual-only remote arrows. The extended solo browser test holds real movement/jump keys and measures both local and remote arrow impacts against the original rock triangles. Its test-only hook requires `?collisionTest=1` and pauses only automatic simulation advancement during deterministic fixed-step bursts. Legacy cylinder helpers remain for geometry-free callers and existing isolated tests; hosted gameplay always builds and uses the BVH. `three` and its types link to the existing pinned engine installation, so no duplicate engine dependency tree or browser download was needed.

### 2026-09-09 — flicker and lag diagnostics

A consecutive-frame probe on the Mac Metal renderer did not reproduce canvas flicker: static solo, one-client online, and two-client online runs kept constant canvas size, render scale, camera, scene population, and one render per animation frame. It did confirm that the HUD replaced unchanged text nodes about 30 times per second and did still more work when 20 Hz multiplayer state arrived (108 mutation records in the one-client sample and 198 with two clients). The runtime also requested a dirty render directly even though its component return value already asked the Entity Component Plugin for the same render.

HUD writes are now skipped unless their displayed value actually changes, reducing the same probe to zero HUD mutations without changing the display or gameplay. The redundant dirty request was removed so Threepipe remains the sole render-loop owner. A five-minute F8/F9 client telemetry buffer and payload-free structured room logs were added so any real-display recurrence or lag spike can be correlated by timestamp without keeping the Durable Object awake while idle.
