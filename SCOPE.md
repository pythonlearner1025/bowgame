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

## Multiplayer: not yet

This port is local-only. No transport, synchronization, lobby, authority, persistence, or remote player behavior has been added.
