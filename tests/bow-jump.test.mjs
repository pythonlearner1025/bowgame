/** Specifies grounded jump timing across movement modes and edge departures. */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { build } from 'esbuild';
import { rm, writeFile } from 'node:fs/promises';

const path = new URL('../.bow-jump-test.mjs', import.meta.url);
const bundled = await build({
  stdin: {
    contents:
      `export {BowGameRuntime} from './src/BowGameRuntime.ts';` +
      `export {BowCollision} from './src/BowCollision.ts';export * from 'three';`,
    resolveDir: new URL('..', import.meta.url).pathname,
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  plugins: [
    {
      name: 'three-only',
      setup(pluginBuild) {
        // The anchored expression replaces only the bare threepipe package import.
        pluginBuild.onResolve({ filter: /^threepipe$/ }, () => ({
          path: new URL('../node_modules/three/build/three.module.js', import.meta.url).pathname,
        }));
      },
    },
  ],
});
await writeFile(path, bundled.outputFiles[0].text);
after(() => rm(path, { force: true }));
globalThis.ImageData ??= class {};
const {
  BowCollision,
  BowGameRuntime,
  BoxGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Vector3,
} = await import(path.href);

const FIXED_STEPS_PER_SECOND = 120;
const FIXED_STEP_SECONDS = 1 / FIXED_STEPS_PER_SECOND;
const STANDING_DURATION_SECONDS = 2;
const INSIDE_COYOTE_STEP_COUNT = 6;
const OUTSIDE_COYOTE_STEP_COUNT = 13;
const EDGE_CLEARANCE_METERS = 1;
const MINIMUM_JUMP_SPEED_METERS_PER_SECOND = 4;
const MINIMUM_FIRST_STEP_HEIGHT_METERS = 0.03;

function floorFixture() {
  const group = new Group();
  const material = new MeshBasicMaterial({ side: DoubleSide });
  const floor = new Mesh(new PlaneGeometry(40, 40), material);
  floor.rotation.x = -Math.PI / 2;
  floor.userData.bowSolid = true;
  group.add(floor);
  const crate = new Mesh(new BoxGeometry(1, 0.95, 1), material);
  crate.position.set(0, 0.475, 0);
  crate.userData.bowSolid = true;
  group.add(crate);

  return new BowCollision(group);
}

function platformFixture() {
  const group = new Group();
  const material = new MeshBasicMaterial({ side: DoubleSide });
  const platform = new Mesh(new PlaneGeometry(1, 4), material);
  platform.rotation.x = -Math.PI / 2;
  platform.userData.bowSolid = true;
  group.add(platform);

  return new BowCollision(group);
}

function jumpRuntime(collision, position) {
  const game = new BowGameRuntime({});
  game.config = { obstacles: [], scoreLimit: 10 };
  game.collision = collision;
  game.player.copy(position);

  return game;
}

function pressJump(game) {
  game.keys.add('Space');
  game.step(FIXED_STEP_SECONDS);
  game.keys.delete('Space');
}

function walkOffPlatform(game) {
  game.keys.add('KeyD');
  while (game.grounded || game.player.x === 0) {
    game.step(FIXED_STEP_SECONDS);
  }
  // Clear rounded edge contact without consuming the coyote window under test.
  game.player.x += EDGE_CLEARANCE_METERS;
  game.keys.clear();
}

test('Player jumps after standing still for two seconds.', () => {
  const collision = floorFixture();
  const game = jumpRuntime(collision, new Vector3(2, 0, 0));
  for (let i = 0; i < FIXED_STEPS_PER_SECOND * STANDING_DURATION_SECONDS; i++) {
    game.step(FIXED_STEP_SECONDS);
  }
  const groundedHeight = game.player.y;

  pressJump(game);

  assert.ok(game.player.y > groundedHeight);
  assert.ok(game.velocity.y > 0);
  collision.dispose();
});

test('Player jumps on the first walking step from fresh support.', () => {
  const collision = floorFixture();
  const game = jumpRuntime(collision, new Vector3(2, 0, 0));
  game.keys.add('KeyW');
  game.keys.add('Space');

  game.step(FIXED_STEP_SECONDS);

  assert.ok(game.player.y > MINIMUM_FIRST_STEP_HEIGHT_METERS);
  assert.ok(game.velocity.y > MINIMUM_JUMP_SPEED_METERS_PER_SECOND);
  collision.dispose();
});

test('Player jumps while sprinting from fresh support.', () => {
  const collision = floorFixture();
  const game = jumpRuntime(collision, new Vector3(2, 0, 0));
  game.keys.add('KeyW');
  game.keys.add('ShiftLeft');
  game.keys.add('Space');

  game.step(FIXED_STEP_SECONDS);

  assert.ok(game.player.y > MINIMUM_FIRST_STEP_HEIGHT_METERS);
  assert.ok(game.velocity.y > MINIMUM_JUMP_SPEED_METERS_PER_SECOND);
  collision.dispose();
});

test('Player jumps immediately from a crate top.', () => {
  const collision = floorFixture();
  const game = jumpRuntime(collision, new Vector3(0, 0.9501, 0));

  pressJump(game);

  assert.ok(game.player.y > 0.9501);
  assert.ok(game.velocity.y > 0);
  collision.dispose();
});

test('Player jumps inside the coyote window after leaving a platform.', () => {
  const collision = platformFixture();
  const game = jumpRuntime(collision, new Vector3(0, 0.0001, 0));
  walkOffPlatform(game);
  for (let i = 0; i < INSIDE_COYOTE_STEP_COUNT; i++) {
    game.step(FIXED_STEP_SECONDS);
  }

  pressJump(game);

  assert.ok(game.velocity.y > MINIMUM_JUMP_SPEED_METERS_PER_SECOND);
  collision.dispose();
});

test('Player cannot jump after the coyote window expires.', () => {
  const collision = platformFixture();
  const game = jumpRuntime(collision, new Vector3(0, 0.0001, 0));
  walkOffPlatform(game);
  for (let i = 0; i < OUTSIDE_COYOTE_STEP_COUNT; i++) {
    game.step(FIXED_STEP_SECONDS);
  }

  pressJump(game);

  assert.ok(game.velocity.y < 1);
  collision.dispose();
});
