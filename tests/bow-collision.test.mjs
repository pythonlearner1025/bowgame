/** Specifies arena BVH collision, movement, spawn, and projectile behavior. */
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { build } from 'esbuild';
import { writeFile, rm } from 'node:fs/promises';
const path = new URL('../.bow-collision-test.mjs', import.meta.url);
const bundled = await build({
  stdin: {
    contents: `export {BowGameRuntime} from './src/BowGameRuntime.ts';export {BowCollision,PLAYER_HEIGHT} from './src/BowCollision.ts';export {buildBowArena} from './src/BowArena.ts';export * from 'three';`,
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
      setup(secondValue) {
        secondValue.onResolve({ filter: /^threepipe$/ }, () => ({
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
  BowGameRuntime,
  BowCollision,
  buildBowArena,
  Vector3,
  Group,
  Mesh,
  MeshBasicMaterial,
  BoxGeometry,
  PlaneGeometry,
  SphereGeometry,
  Raycaster,
  DoubleSide,
  InstancedMesh,
  Matrix4,
} = await import(path.href);
// Canvas painting only is inert; every seeded random call and all real arena triangles remain unchanged.
const context = new Proxy(
  {
    createRadialGradient() {
      return { addColorStop() {} };
    },
  },
  {
    get: (objectValue, k) => objectValue[k] ?? (() => {}),
    set: (objectValue, k, value) => {
      objectValue[k] = value;

      return true;
    },
  },
);
globalThis.document = {
  createElement() {
    return {
      getContext() {
        return context;
      },
    };
  },
};
const arena = buildBowArena(),
  world = new BowCollision(arena.group);
after(() => {
  world.dispose();
  delete globalThis.document;
});
const dt = 1 / 120;

function advance(candidate, point, value, options) {
  const dx = options.dx ?? 0;
  const dz = options.dz ?? 0;
  let ground = false;

  for (let i = 0; i < options.count; i++) {
    value.x = dx;
    value.z = dz;
    value.y -= 9.81 * dt;
    ground = candidate.move(point, value, dt);
  }

  return ground;
}

function fixture() {
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

function jumpRuntime(candidate, position) {
  const game = new BowGameRuntime({});
  game.config = { obstacles: [], scoreLimit: 10 };
  game.collision = candidate;
  game.player.copy(position);

  return game;
}

function pressJump(game) {
  game.keys.add('Space');
  game.step(dt);
  game.keys.delete('Space');
}

function platformFixture() {
  const group = new Group();
  const material = new MeshBasicMaterial({ side: DoubleSide });
  const platform = new Mesh(new BoxGeometry(1, 0.2, 4), material);
  platform.userData.bowSolid = true;
  group.add(platform);

  return new BowCollision(group);
}

test('arrows meet actual weathered granite triangles within 1 cm of reference raycast', () => {
  arena.group.traverse((matrixValue) => {
    if (matrixValue.isMesh) {
      matrixValue.material.side = DoubleSide;
    }
  });
  const rocks = arena.group.children.filter(
    (matrixValue) => matrixValue.name === 'Weathered granite',
  );

  for (const rock of rocks) {
    rock.material.side = DoubleSide;
    const firstValue = rock.position.clone().add(new Vector3(0.031, 0.137, rock.scale.z * 2)),
      secondValue = rock.position.clone().add(new Vector3(0.031, 0.137, 0));
    const ref = new Raycaster(
      firstValue,
      secondValue.clone().sub(firstValue).normalize(),
    ).intersectObjects(
      arena.group.children.filter((matrixValue) => matrixValue.userData.bowSolid),
    )[0];
    assert.ok(ref);
    const hit = world.segment(firstValue, secondValue);
    assert.ok(hit);
    assert.ok(
      hit.point.distanceTo(ref.point) < 0.01,
      JSON.stringify({
        rock: rock.position.toArray(),
        hit: hit.point.toArray(),
        ref: ref.point.toArray(),
        object: ref.object.name,
      }),
    );
  }
});
test('capsule rests on visible floor at -0.04, and remains supported', () => {
  const point = new Vector3(0, 3, 17),
    value = new Vector3();
  assert.ok(advance(world, point, value, { count: 240 }));
  assert.ok(Math.abs(point.y + 0.04) < 0.001);
  assert.ok(world.penetration(point) < 0.001);
});
test('walking and sprinting into a rock stop with under 1 cm penetration', () => {
  for (const speed of [4.5, 7]) {
    const point = new Vector3(9, 0, 10),
      value = new Vector3();
    advance(world, point, value, { count: 360, dz: -speed });
    assert.ok(point.z > 6.5, point.toArray().join(','));
    assert.ok(world.penetration(point) < 0.01);
  }
});
test('unchanged jump lands on crate top, then walking off falls to floor', () => {
  const candidate = fixture(),
    point = new Vector3(0, 0, 1.35),
    value = new Vector3();
  advance(candidate, point, value, { count: 2 });
  value.y = 4.8;
  advance(candidate, point, value, { count: 38, dz: -4.5 });
  assert.ok(advance(candidate, point, value, { count: 160 }));
  assert.ok(Math.abs(point.y - 0.95) < 0.002, point.toArray().join(','));
  advance(candidate, point, value, { count: 120, dx: 4.5 });
  advance(candidate, point, value, { count: 120 });
  assert.ok(Math.abs(point.y) < 0.002);
  candidate.dispose();
});
test('all solo and ten online slot spawns are free, including embedded spawn recovery', () => {
  const wanted = [arena.playerSpawn, ...arena.botSpawns];

  for (let slot = 1; slot < 10; slot++) {
    const secondValue = arena.botSpawns[(slot - 1) % 3],
      result = Math.floor((slot - 1) / 3);
    wanted.push(
      new Vector3(
        secondValue.x + (result % 2 ? 5 : -5) * result,
        secondValue.y,
        secondValue.z + (result % 2 ? -4 : 4) * result,
      ),
    );
  }

  wanted.push(new Vector3(9, 1, 5), new Vector3(6.7, 0.4, -3.7));

  for (const w of wanted) {
    const point = world.spawn(w, 0.42);
    assert.ok(world.penetration(point, 0.42) < 0.001);
    const value = new Vector3();
    assert.ok(advance(world, point, value, { count: 2 }));
  }
});
test('solid instancing expands world transforms; untagged decoration stays passable', () => {
  const group = new Group();
  group.position.x = 3;
  const matrixValue = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial(), 2);
  matrixValue.userData.bowSolid = true;
  matrixValue.setMatrixAt(0, new Matrix4().makeTranslation(0, 1, 0));
  matrixValue.setMatrixAt(1, new Matrix4().makeTranslation(3, 1, 0));
  group.add(matrixValue);
  const decoration = new Mesh(new SphereGeometry(1), matrixValue.material);
  decoration.position.set(9, 1, 0);
  group.add(decoration);
  const candidate = new BowCollision(group);
  assert.equal(candidate.solidMeshes, 2);
  for (const x of [3, 6]) {
    assert.ok(candidate.segment(new Vector3(x, 1, 2), new Vector3(x, 1, -2)));
  }
  assert.equal(candidate.segment(new Vector3(12, 1, 2), new Vector3(12, 1, -2)), null);
  candidate.dispose();
});
test('full arena collision cost benchmark (four capsules per fixed step)', () => {
  const point = [
      new Vector3(9, 0, 8),
      new Vector3(-8, 0, 11),
      new Vector3(0, 0, 17),
      new Vector3(6.7, 2, -3.7),
    ],
    value = point.map(() => new Vector3());
  const timings = [];

  for (let i = 0; i < 1200; i++) {
    const start = performance.now();
    point.forEach((quaternion, j) =>
      advance(world, quaternion, value[j], { count: 1, dz: j < 2 ? -4.5 : 0 }),
    );
    timings.push(performance.now() - start);
  }

  timings.sort((firstValue, secondValue) => firstValue - secondValue);
  console.log(
    JSON.stringify({
      bvh: world.stats(),
      fourCapsuleStepMs: { p50: timings[600], p95: timings[1140], max: timings.at(-1) },
    }),
  );
  assert.ok(world.buildMs < 300);
});

test('world and player hits compete by nearest distance; remote visuals never apply damage', () => {
  const setup = () => {
    const game = new BowGameRuntime({});
    game.config = { scoreLimit: 10, obstacles: [] };
    game.collision = world;
    game.player.set(0, 0, 17);
    const target = { mesh: new Group(), hp: 100, kills: 0, deaths: 0, name: 'test' };
    game.bots = [target];

    return { game, target };
  };

  const run = (game) => {
    for (let i = 0; i < 20; i++) {
      game.stepArrows(dt);
    }
  };

  const blocked = setup();
  blocked.target.mesh.position.set(9, 0, 4);
  blocked.game.fire(new Vector3(9, 1.05, 10), new Vector3(0, 0, -1), -1, 1);
  run(blocked.game);
  assert.equal(blocked.target.hp, 100);
  assert.ok(blocked.game.lastWorldImpact);
  assert.ok(blocked.game.arrows[0].stuck);
  const near = setup();
  near.target.mesh.position.set(9, 0, 9);
  near.game.fire(new Vector3(9, 1.05, 10), new Vector3(0, 0, -1), -1, 1);
  run(near.game);
  assert.equal(near.target.hp, 30);
  assert.equal(near.game.lastWorldImpact, null);
  const remote = setup();
  remote.game.player.set(9, 0, 9);
  remote.game.spawnArrow(new Vector3(9, 1.05, 10), new Vector3(0, 0, -56), {
    owner: 0,
    arrowId: 'remote',
    isVisualOnly: true,
  });
  run(remote.game);
  assert.equal(remote.game.hp, 100);
  assert.ok(remote.game.arrows[0].stuck);
  assert.equal(remote.game.arrows[0].mesh.visible, false);
  assert.equal(remote.game.lastWorldImpact, null);
});
test('all required arena parts are solid; foliage, grass and scree are excluded', () => {
  const names = new Set();
  arena.group.traverse((matrixValue) => {
    if (matrixValue.isMesh && matrixValue.userData.bowSolid) {
      names.add(matrixValue.name);
    }
  });
  assert.deepEqual(
    [...names].sort(),
    [
      'Forest floor',
      'Weathered granite',
      'Pine trunk',
      'Ruined stone wall',
      'Broken wall cap',
      'Supply crate',
      'Crate strap',
      'Shelter post',
      'Weathered shelter tarp',
      'Salvaged barricade plank',
      'Fallen pine',
    ].sort(),
  );
  assert.equal(world.solidMeshes, 129);
});
test('real runtime jump input lands on the authored crate without a second jump', () => {
  const game = new BowGameRuntime({});
  game.config = { obstacles: [], scoreLimit: 10 };
  game.collision = world;
  game.player.set(6.7, 0, -2.35);
  for (let i = 0; i < 30; i++) {
    game.step(dt);
  }
  game.keys.add('Space');
  game.keys.add('KeyW');
  game.step(dt);
  game.keys.delete('Space');
  for (let i = 0; i < 51; i++) {
    game.step(dt);
  }
  game.keys.clear();
  for (let i = 0; i < 160; i++) {
    game.step(dt);
  }
  assert.ok(game.grounded);
  assert.ok(game.player.y > 0.9 && game.player.y < 1);
});

test('player jumps after standing still for two seconds', () => {
  const candidate = fixture();
  const game = jumpRuntime(candidate, new Vector3(2, 0, 0));
  for (let i = 0; i < 240; i++) {
    game.step(dt);
  }
  const groundedHeight = game.player.y;

  pressJump(game);

  assert.ok(game.player.y > groundedHeight);
  assert.ok(game.velocity.y > 0);
  candidate.dispose();
});

test('player jumps on the first walking step from fresh support', () => {
  const candidate = fixture();
  const game = jumpRuntime(candidate, new Vector3(2, 0, 0));
  game.keys.add('KeyW');
  game.keys.add('Space');

  game.step(dt);

  assert.ok(game.player.y > 0.03);
  assert.ok(game.velocity.y > 4);
  candidate.dispose();
});

test('player jumps while sprinting from fresh support', () => {
  const candidate = fixture();
  const game = jumpRuntime(candidate, new Vector3(2, 0, 0));
  game.keys.add('KeyW');
  game.keys.add('ShiftLeft');
  game.keys.add('Space');

  game.step(dt);

  assert.ok(game.player.y > 0.03);
  assert.ok(game.velocity.y > 4);
  candidate.dispose();
});

test('player jumps immediately from a crate top', () => {
  const candidate = fixture();
  const game = jumpRuntime(candidate, new Vector3(0, 0.9501, 0));

  pressJump(game);

  assert.ok(game.player.y > 0.9501);
  assert.ok(game.velocity.y > 0);
  candidate.dispose();
});

test('player jumps inside the coyote window after leaving a platform', () => {
  const candidate = platformFixture();
  const game = jumpRuntime(candidate, new Vector3(0, 0.1001, 0));
  game.keys.add('KeyD');
  while (game.grounded || game.player.x < 0.9) {
    game.step(dt);
  }
  game.keys.clear();
  for (let i = 0; i < 6; i++) {
    game.step(dt);
  }

  pressJump(game);

  assert.ok(game.velocity.y > 4);
  candidate.dispose();
});

test('player cannot jump after the coyote window expires', () => {
  const candidate = platformFixture();
  const game = jumpRuntime(candidate, new Vector3(0, 0.1001, 0));
  game.keys.add('KeyD');
  while (game.grounded || game.player.x < 0.9) {
    game.step(dt);
  }
  game.keys.clear();
  for (let i = 0; i < 13; i++) {
    game.step(dt);
  }

  pressJump(game);

  assert.ok(game.velocity.y < 1);
  candidate.dispose();
});

test('spawn stays under the open shelter canopy instead of treating the tarp as a filled volume', () => {
  const point = world.spawn(new Vector3(11.5, 0, -18));
  assert.ok(point.distanceTo(new Vector3(11.5, -0.04, -18)) < 0.001);
});
test('walkable slope supports the capsule; a steep face does not report ground', () => {
  for (const angle of [45, 60]) {
    const group = new Group(),
      ramp = new Mesh(new PlaneGeometry(20, 20), new MeshBasicMaterial({ side: DoubleSide }));
    ramp.rotation.set(-Math.PI / 2, (angle * Math.PI) / 180, 0);
    ramp.userData.bowSolid = true;
    group.add(ramp);
    const candidate = new BowCollision(group),
      point = new Vector3(0, 0.2, 0),
      value = new Vector3();
    const grounded = advance(candidate, point, value, { count: 60 });
    assert.equal(grounded, angle === 45);
    assert.ok(candidate.penetration(point) < 0.01);
    candidate.dispose();
  }
});
console.log(
  'legacy collision inventory',
  JSON.stringify({
    covers: arena.obstacles.length,
    trunkCylinders: arena.group.children.filter(
      (matrixValue) =>
        matrixValue.name === 'Pine trunk' &&
        arena.obstacles.some(
          (objectValue) =>
            objectValue.x === matrixValue.position.x && objectValue.z === matrixValue.position.z,
        ),
    ).length,
  }),
);

test('spawn clearance rejects a thin canopy piercing the capsule axis', () => {
  const group = new Group(),
    roof = new Mesh(new PlaneGeometry(4, 4), new MeshBasicMaterial({ side: DoubleSide }));
  roof.rotation.x = -Math.PI / 2;
  roof.position.y = 1;
  roof.userData.bowSolid = true;
  group.add(roof);
  const candidate = new BowCollision(group);
  assert.ok(candidate.penetration(new Vector3(0, 0, 0)) > 0.3);
  const spawn = candidate.spawn(new Vector3(0, 0, 0));
  assert.ok(spawn.y >= 1);
  assert.ok(candidate.penetration(spawn) < 0.001);
  candidate.dispose();
});
