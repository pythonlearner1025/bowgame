/** Specifies trail pooling and runtime draw/release transition behavior. */
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

// Real runtime handlers, geometry, skeleton-target transforms, and clip sampler.
// Only the unrelated browser arena authoring factory is replaced.
const bundled = await build({
  stdin: {
    contents: `export {BowArrowTrails,ARROW_TRAIL_CAPACITY} from './src/BowArrowTrail.ts'; export {BowGameRuntime} from './src/BowGameRuntime.ts'; export {sampleReferenceAction,sampleReferenceTimeline,referenceScreenPoint} from './src/BowReferenceClip.ts'; export {makeFieldBow,makeArm,firstPersonSkin} from './src/BowVisuals.ts'; export {Group,Vector3,PerspectiveCamera} from 'threepipe';`,
    resolveDir: new URL('..', import.meta.url).pathname,
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  plugins: [
    {
      name: 'browser-independent-runtime',
      setup(secondValue) {
        secondValue.onResolve({ filter: /^threepipe$/ }, () => ({
          path: new URL(
            '../node_modules/threepipe/node_modules/three/build/three.module.js',
            import.meta.url,
          ).pathname,
        }));
        secondValue.onResolve({ filter: /BowArena\.ts$/ }, () => ({
          path: 'arena',
          namespace: 'stub',
        }));
        secondValue.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
          contents:
            'export function buildBowArena(){throw new Error("Not used in transition tests");}',
          loader: 'js',
        }));
      },
    },
  ],
});
const temporary = await mkdtemp(join(tmpdir(), 'kite3d-bow-transition-'));
after(() => rm(temporary, { recursive: true, force: true }));
await writeFile(join(temporary, 'runtime.mjs'), bundled.outputFiles[0].text);
globalThis.ImageData ??= class ImageData {};
const {
  BowArrowTrails,
  ARROW_TRAIL_CAPACITY,
  BowGameRuntime,
  makeFieldBow,
  makeArm,
  firstPersonSkin,
  Group,
  Vector3,
  PerspectiveCamera,
} = await import(pathToFileURL(join(temporary, 'runtime.mjs')));

function harness() {
  const camera = new PerspectiveCamera(76, 16 / 9, 0.1, 200);
  camera.target = new Vector3();
  camera.controls = { enabled: false };
  const canvas = {},
    viewer = {
      canvas,
      scene: { mainCamera: camera, modelRoot: { userData: { kite3dBowGame: {} } } },
      setDirty() {},
    };
  const game = new BowGameRuntime(viewer);
  game.config = {
    version: 1,
    kind: 'bow-deathmatch',
    botCount: 1,
    scoreLimit: 10,
    difficulty: 'normal',
    obstacles: [],
    playerSpawn: { x: 0, y: 0, z: 0 },
    botSpawns: [{ x: 0, y: 0, z: -6 }],
  };
  game.running = true;
  game.active = true;
  game.root = new Group();
  game.bow = makeFieldBow();
  const skin = firstPersonSkin();
  game.leftArm = makeArm(skin, -1);
  game.rightArm = makeArm(skin, 1);
  game.arm = game.leftArm.root;
  game.hand = game.rightArm.root;
  game.root.add(game.bow, game.heldArrow, game.arm, game.hand);
  const mouse = (button) => ({
    button,
    target: canvas,
    preventDefault() {},
    stopImmediatePropagation() {},
  });

  const render = () => {
    game.updateCamera();
    game.root.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
  };

  const advance = (seconds) => {
    for (let remaining = seconds; remaining > 1e-10;) {
      const dt = Math.min(1 / 120, remaining);
      game.step(dt);
      render();
      remaining -= dt;
    }
  };

  render();

  return { game, mouse, render, advance, camera };
}

test('live streak samples actual gravity-curved physics positions', () => {
  const { game, advance, camera } = harness();
  game.fire(new Vector3(0, 8, 0), new Vector3(0, 0.1, -1).normalize(), -1, 1);
  advance(0.25);
  const arrow = game.arrows[0],
    slot = game.trails.slots[arrow.trail.slot];
  assert.ok(slot.count > 10);
  assert.ok(slot.points[slot.count - 1].distanceTo(arrow.position) < 1e-9);
  const first = slot.points[0],
    mid = slot.points[Math.floor(slot.count / 2)],
    last = slot.points[slot.count - 1],
    linear = first.clone().lerp(last, (mid.z - first.z) / (last.z - first.z));
  assert.ok(mid.y > linear.y + 0.003, 'gravity curve must not become a straight velocity ray');
  game.trails.update(game.elapsed, camera.position);
  assert.equal(slot.mesh.visible, true);
  const vertices = (slot.mesh.geometry.drawRange.count / 6 + 1) * 2;

  for (let i = 0; i < vertices; i += 2) {
    const firstValue = new Vector3().fromArray(slot.positions, i * 3),
      secondValue = new Vector3().fromArray(slot.positions, (i + 1) * 3);
    assert.ok(
      firstValue.distanceTo(secondValue) < 0.05,
      'world ribbon must remain narrower than5cm',
    );
    assert.ok(slot.alpha[i] >= 0 && slot.alpha[i] <= 0.93, 'trail must remain translucent');
  }

  assert.ok(Math.max(...slot.alpha) > 0.85, 'fresh white trail core must remain legible');
  assert.ok(
    slot.alpha[(slot.mesh.geometry.drawRange.count / 6 + 1) * 2 - 1] > slot.alpha[0],
    'older tail samples fade',
  );
});
test('cover clips trail and rendered arrow tip; impact tail decays', () => {
  const { game, advance } = harness();
  game.config.obstacles = [{ x: 0, z: -3, r: 0.5, height: 4 }];
  game.fire(new Vector3(0, 2, 0), new Vector3(0, 0, -1), -1, 1);
  advance(0.08);
  const arrow = game.arrows[0];
  assert.equal(arrow.stuck, true);
  const slot = game.trails.slots[arrow.trail.slot],
    count = slot.count;
  for (let i = 0; i < count; i++) {
    assert.ok(slot.points[i].z >= -2.5 - 1e-6, 'trail cannot pass wall');
  }
  game.root.updateMatrixWorld(true);
  assert.ok(
    arrow.mesh.localToWorld(new Vector3(0, 0, -0.765)).distanceTo(arrow.position) < 1e-8,
    'rendered tip must end at collision',
  );
  advance(0.2);
  assert.equal(slot.count, count);
  assert.equal(slot.mesh.visible, false);
});
test('pool capacity, stale handles and disposal remain bounded', () => {
  const trails = new BowArrowTrails(),
    point = new Vector3(),
    old = trails.spawn(point, 0);
  for (let i = 1; i < ARROW_TRAIL_CAPACITY + 20; i++) {
    trails.spawn(point, i / 120);
  }
  assert.equal(trails.root.children.length, ARROW_TRAIL_CAPACITY);
  const reused = trails.slots[old.slot],
    count = reused.count;
  trails.sample(old, new Vector3(99, 99, 99), 4);
  assert.equal(reused.count, count);
  let disposed = 0;
  for (const sample of trails.slots) {
    sample.mesh.geometry.addEventListener('dispose', () => disposed++);
  }
  trails.material.addEventListener('dispose', () => disposed++);
  trails.dispose();
  assert.equal(disposed, ARROW_TRAIL_CAPACITY + 1);
  assert.equal(trails.slots.length, 0);
});
test('restart clears streaks and HUD has no crosshair or draw-progress bar', async () => {
  const { game, advance } = harness();
  game.fire(new Vector3(0, 5, 0), new Vector3(0, 0, -1), -1, 1);
  advance(0.05);
  game.restart();
  assert.ok(game.trails.slots.every((sample) => !sample.active && !sample.mesh.visible));
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/BowGameRuntime.ts', import.meta.url), 'utf8');
  assert.ok(!source.includes("add('cross'"));
  assert.ok(!source.includes("add('charge'"));
  assert.ok(!source.includes('this.hud.charge'));
});
test('bounded flight inspection advances real physics and reset removes projectile residue', () => {
  const { game } = harness();
  for (const value of [-0.01, 1.01, NaN]) {
    assert.throws(() => game.inspect({ flightSeconds: value }));
  }
  game.inspect({ flightSeconds: 0.15, flightSide: true });
  assert.equal(game.arrows.length, 1);
  assert.ok(Math.abs(game.elapsed - 0.15) < 1e-9);
  assert.equal(game.arrows[0].age, game.elapsed);
  const firstValue = game.arrows[0],
    slot = game.trails.slots[firstValue.trail.slot];
  assert.ok(Math.abs(slot.times[slot.count - 1] - 0.15) < 1e-9);
  assert.ok(slot.points[slot.count - 1].distanceTo(firstValue.position) < 1e-9);
  assert.equal(game.heldArrow.visible, false);
  game.inspect({ draw: 0 });
  assert.equal(game.arrows.length, 0);
  assert.ok(game.trails.slots.every((sample) => !sample.active && !sample.mesh.visible));
  assert.equal(game.elapsed, 0);
});
