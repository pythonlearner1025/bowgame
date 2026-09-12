/** Specifies runtime lifecycle, rendering, state, and input behavior in a headless harness. */
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
const bundled = await build({
  stdin: {
    contents: `export {BowGameRuntime} from './src/BowGameRuntime.ts'; export {attachHumanAsset} from './src/BowHumanAsset.ts'; export {attachFirstPersonArm} from './src/BowHandRig.ts'; export {sampleReferenceAction,sampleReferenceTimeline,referenceArrow,referenceScreenPoint} from './src/BowReferenceClip.ts'; export {sampleBowPose,makeFieldBow,deformBow,bowNock,makeHuman,poseHuman,makeArm,poseArm,firstPersonSkin} from './src/BowVisuals.ts'; export {Group,Vector3,PerspectiveCamera,Quaternion} from 'threepipe';`,
    resolveDir: new URL('..', import.meta.url).pathname,
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  plugins: [
    {
      name: 'runtime-harness',
      setup(secondValue) {
        // Keep real Three geometry/vectors, replace only the browser-only arena authoring factory.
        secondValue.onResolve({ filter: /^threepipe$/ }, () => ({
          path: new URL('../node_modules/three/build/three.module.js', import.meta.url).pathname,
        }));
        secondValue.onResolve({ filter: /BowArena\.ts$/ }, () => ({
          path: 'arena',
          namespace: 'stub',
        }));
        secondValue.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
          contents:
            'export function buildBowArena(){throw new Error("Not used in runtime tests");}',
          loader: 'js',
        }));
      },
    },
  ],
});
const temporary = await mkdtemp(join(tmpdir(), 'kite3d-bow-runtime-'));
after(() => rm(temporary, { recursive: true, force: true }));
await writeFile(join(temporary, 'runtime.mjs'), bundled.outputFiles[0].text);
// Threepipe's vendored Three texture defaults reference this browser type at import.
globalThis.ImageData ??= class ImageData {};
const {
  sampleReferenceAction,
  sampleReferenceTimeline,
  referenceArrow,
  attachFirstPersonArm,
  attachHumanAsset,
  BowGameRuntime,
  Group,
  Vector3,
  PerspectiveCamera,
  Quaternion,
  sampleBowPose,
  makeFieldBow,
  deformBow,
  bowNock,
  makeHuman,
  poseHuman,
  makeArm,
  poseArm,
  firstPersonSkin,
} = await import(pathToFileURL(join(temporary, 'runtime.mjs')));

function harness() {
  const camera = new PerspectiveCamera(76, 1, 0.1, 200);
  camera.target = new Vector3();
  camera.controls = { enabled: false };
  const canvas = {};
  const viewer = {
    canvas,
    scene: { mainCamera: camera, modelRoot: { userData: { kite3dBowGame: {} } } },
    setDirty() {},
  };
  const game = new BowGameRuntime(viewer);
  game.state.config = {
    version: 1,
    kind: 'bow-deathmatch',
    botCount: 1,
    scoreLimit: 1,
    difficulty: 'normal',
    obstacles: [],
    playerSpawn: { x: 0, y: 0, z: 0 },
    botSpawns: [{ x: 0, y: 0, z: -6 }],
  };
  game.state.running = true;
  game.state.active = true;
  game.world.root = new Group();
  game.state.bow = makeFieldBow();
  game.world.root.add(game.state.bow, game.state.heldArrow, game.state.arm, game.state.hand);
  const key = (code) => ({
    code,
    target: null,
    repeat: false,
    preventDefault() {},
    stopImmediatePropagation() {},
  });
  const mouse = (button) => ({
    button,
    target: canvas,
    preventDefault() {},
    stopImmediatePropagation() {},
  });

  return { game, key, mouse };
}

test('real WASD handlers move camera-relative, stop on keyup, and slide against cover', () => {
  const { game, key } = harness();
  game.playerController.onKeyDown(key('KeyW'));
  for (let i = 0; i < 120; i++) {
    game.step(1 / 120);
  }
  assert.ok(game.state.player.z < -4.4 && game.state.player.z > -4.6);
  game.playerController.onKeyUp(key('KeyW'));
  const stopped = game.state.player.clone();
  game.step(0.1);
  assert.deepEqual(game.state.player, stopped);
  game.state.yaw = Math.PI / 2;
  game.playerController.onKeyDown(key('KeyW'));
  game.step(0.1);
  assert.ok(game.state.player.x < -0.4);
  game.state.player.set(0, 0, 0);
  game.state.yaw = 0;
  game.state.config.obstacles = [{ x: 0, z: -1, r: 0.5, height: 2 }];
  for (let i = 0; i < 100; i++) {
    game.step(1 / 120);
  }
  assert.ok(game.state.player.z > -0.13);
});
test('real draw/release handlers launch an arrow that hits a bot, awards kill, and ends match', () => {
  const { game, mouse } = harness();
  game.playerController.onMouseDown(mouse(0));
  for (let i = 0; i < 150; i++) {
    game.step(1 / 120);
  }
  assert.equal(game.state.charge, 1);
  const bot = game.bots.create(0);
  bot.mesh.position.set(0, 0, -6);
  game.state.bots = [bot];
  game.playerController.onMouseUp(mouse(0));
  assert.equal(game.state.arrows.length, 1);
  assert.equal(game.state.arrows[0].damage, 70);
  assert.equal(game.state.charge, 0);
  assert.equal(game.state.drawing, false);
  for (let i = 0; i < 40; i++) {
    game.arrows.step(1 / 120);
  }
  assert.equal(bot.hp, 0);
  assert.equal(bot.deaths, 1);
  assert.equal(game.state.kills, 1);
  assert.equal(game.state.winner, 'YOU');
  assert.equal(bot.mesh.visible, false);
  assert.deepEqual(
    game.state.deathFeed.map(({ killer, victim }) => ({ killer, victim })),
    [{ killer: 'YOU', victim: 'ASH' }],
  );
});
test('bot arrows damage the player, credit bot kills, and respawn without resetting score', () => {
  const { game } = harness();
  game.state.config.scoreLimit = 10;
  const bot = game.bots.create(0);
  game.state.bots = [bot];
  game.arrows.fire(new Vector3(0, 1.05, -3), new Vector3(0, 0, 1), 0, 1);
  for (let i = 0; i < 20; i++) {
    game.arrows.step(1 / 120);
  }
  assert.equal(game.state.hp, 30);
  game.arrows.fire(new Vector3(0, 1.05, -3), new Vector3(0, 0, 1), 0, 1);
  for (let i = 0; i < 20; i++) {
    game.arrows.step(1 / 120);
  }
  assert.equal(game.state.hp, 0);
  assert.equal(game.state.deaths, 1);
  assert.equal(bot.kills, 1);
  assert.equal(game.state.deathFeed[0].killer, 'ASH');
  assert.equal(game.state.deathFeed[0].victim, 'YOU');
  game.state.elapsed = game.state.deadUntil;
  game.step(1 / 120);
  assert.equal(game.state.hp, 100);
  assert.equal(game.state.deaths, 1);
  assert.equal(bot.kills, 1);
});
test('R clears score and old killfeed; blur cancels a drawn shot', () => {
  const { game, key, mouse } = harness();
  game.addDeath('ASH', 'YOU');
  game.state.message = 'ASH eliminated you';
  game.state.messageUntil = 100;
  game.state.kills = 8;
  game.state.deaths = 4;

  // Skip render-only update: restart uses real simulation state and the same R handler.
  game.playerController.updateCamera = () => {};

  game.playerController.onKeyDown(key('KeyR'));
  assert.equal(game.state.kills, 0);
  assert.equal(game.state.deaths, 0);
  assert.equal(game.state.hp, 100);
  assert.equal(game.state.message, '');
  assert.equal(game.state.messageUntil, 0);
  assert.deepEqual(game.state.deathFeed, []);
  game.playerController.onMouseDown(mouse(0));
  game.step(0.2);
  assert.ok(game.state.charge > 0);
  game.playerController.onBlur();
  assert.equal(game.state.active, false);
  assert.equal(game.state.charge, 0);
  game.playerController.onMouseUp(mouse(0));
  assert.equal(game.state.arrows.length, 0);
});

test('Multiplayer deaths use display names and clear between rounds.', () => {
  const { game } = harness();
  game.remotePlayers.sync = () => {};
  const snapshot = {
    status: 'connected',
    playerId: 'local',
    scores: { local: 1 },
    scoreLimit: 20,
    round: 1,
    winnerId: null,
    latencyMs: null,
    players: [
      { id: 'local', local: true, name: 'Name', slot: 0, deaths: 0 },
      { id: 'remote', local: false, name: 'ROOK', slot: 1, deaths: 1 },
    ],
  };

  game.network.onMessage({ type: 'death', playerId: 'remote', killerId: 'local' }, snapshot);
  assert.deepEqual(
    game.state.deathFeed.map(({ killer, victim }) => ({ killer, victim })),
    [{ killer: 'YOU', victim: 'ROOK' }],
  );
  game.network.onMessage({ type: 'death', playerId: 'local', killerId: 'remote' }, snapshot);
  assert.equal(game.state.deathFeed[0].killer, 'ROOK');
  assert.equal(game.state.deathFeed[0].victim, 'YOU');
  game.combat.resetOnlineRound();
  assert.deepEqual(game.state.deathFeed, []);
});

test('bow draw and release keep the nock on the string, flex without geometry allocation, and recover', () => {
  const bow = makeFieldBow(),
    geometry = bow.userData.bowLimb.geometry,
    string = bow.userData.bowString.geometry;

  for (const charge of [0, 0.25, 0.5, 0.75, 1]) {
    const pose = sampleBowPose(charge);
    deformBow(bow, pose.draw);
    assert.equal(bow.userData.bowLimb.geometry, geometry);
    assert.equal(bow.userData.bowString.geometry, string);
    const center = new Vector3().fromBufferAttribute(string.getAttribute('position'), 1);
    assert.ok(center.distanceTo(bowNock(pose.draw)) < 1e-7);
    assert.ok(pose.pull.distanceTo(bowNock(pose.draw)) < 1e-12);
  }

  const release = sampleBowPose(0, 0, 1),
    snap = sampleBowPose(0, 0.07, 1),
    fetch = sampleBowPose(0, 0.5, 1),
    ready = sampleBowPose(0, 1.05, 1);
  assert.equal(release.draw, 1);
  assert.equal(snap.draw, 0);
  assert.equal(snap.arrowVisible, false);
  assert.ok(fetch.pull.y > 0.4, 'reload lifts string hand to retrieve the arrow');
  assert.equal(ready.phase, 'ready');
  assert.equal(ready.arrowVisible, true);
});
test('human skin geometry is finite, tapered and articulated at the elbow and knee', () => {
  const human = makeHuman();
  let count = 0;
  human.root.traverse((objectValue) => {
    if (!objectValue.isMesh) {
      return;
    }
    count++;
    const point = objectValue.geometry.getAttribute('position');
    for (const value of point.array) {
      assert.ok(Number.isFinite(value));
    }
  });
  assert.ok(count > 70);
  poseHuman(human, 0, 0);
  const resting = human.right.hand.position.clone();
  poseHuman(human, 1, 0.8);
  assert.ok(human.right.hand.position.z > resting.z + 0.3);
  assert.ok(human.right.elbow.position.x > 0.4);
  assert.ok(human.legs[1].shin.rotation.x > 0);
  assert.notEqual(human.legs[0].root.rotation.x, human.legs[1].root.rotation.x);
});
test('release recovery blocks firing until an arrow has been re-nocked', () => {
  const { game, mouse } = harness();
  game.playerController.onMouseDown(mouse(0));
  for (let i = 0; i < 150; i++) {
    game.step(1 / 120);
  }
  game.playerController.onMouseUp(mouse(0));
  game.playerController.onMouseDown(mouse(0));
  assert.equal(game.state.drawing, false);
  assert.equal(game.state.arrows.length, 1);
  for (let i = 0; i < 127; i++) {
    game.step(1 / 120);
  }
  game.playerController.onMouseDown(mouse(0));
  assert.equal(game.state.drawing, true);
  assert.equal(game.state.releaseTime, -1);
});
test('inspection rejects unsafe or unbounded values and never advances combat', () => {
  const { game } = harness();

  game.playerController.updateCamera = () => {};

  game.updateHud = () => {};

  for (const input of [
    { draw: NaN },
    { draw: 2 },
    { orbit: 181 },
    { release: 3 },
    { view: 'code' },
    { referenceTime: -1 },
    { referenceTime: 10.1 },
    { referenceTime: NaN },
    { aim: 'yes' },
  ]) {
    assert.throws(() => game.inspect(input));
  }
  const before = game.getState();
  game.inspect({ view: 'first-person', draw: 1, release: 0.04 });
  assert.equal(game.state.active, false);
  assert.equal(game.getState().elapsed, before.elapsed);
  assert.equal(game.getState().kills, before.kills);
  game.inspect({ resume: true });
  assert.equal(game.getState().preview, null);
  assert.equal(game.getState().kills, 0);
});

test('bundled CC0 adult skin has normalized influences and remains finite in draw and walk poses', async () => {
  const asset = JSON.parse(
    await readFile(
      new URL('../assets/bow-survivor/male-adult-rigged.json', import.meta.url),
      'utf8',
    ),
  );
  assert.ok(asset.positions.length / 3 > 14000);
  assert.ok(asset.indices.length / 3 > 26000);

  for (let i = 0; i < asset.skinWeight.length; i += 4) {
    const sum = asset.skinWeight
      .slice(i, i + 4)
      .reduce((firstValue, secondValue) => firstValue + secondValue, 0);
    assert.ok(Math.abs(sum - 1) < 1e-5);
  }

  const human = makeHuman();
  assert.equal(attachHumanAsset(human, 0, asset), true);

  for (const draw of [0, 0.5, 1]) {
    poseHuman(human, draw, 0.5, draw === 0);
    human.applyPose(draw === 0);
    human.root.updateMatrixWorld(true);
    human.root.traverse((objectValue) => {
      for (const count of objectValue.matrixWorld.elements) {
        assert.ok(Number.isFinite(count));
      }
    });
  }

  const surface = human.root.getObjectByName('CC0 connected adult male anatomy');
  surface.skeleton.update();

  for (let i = 0; i < surface.geometry.getAttribute('position').count; i += 31) {
    const point = new Vector3().fromBufferAttribute(surface.geometry.getAttribute('position'), i);
    surface.applyBoneTransform(i, point);
    assert.ok(point.length() < 3, 'posed body stays bounded in meters');
  }
});

test('first-person CC0 arm preserves textured skinning and its wrist follows grip through camera transforms', async () => {
  const asset = JSON.parse(
    await readFile(
      new URL('../assets/bow-survivor/male-adult-rigged.json', import.meta.url),
      'utf8',
    ),
  );

  for (const side of [-1, 1]) {
    const arm = makeArm(firstPersonSkin(), side);
    assert.equal(attachFirstPersonArm(arm, side, asset), true);
    const surface = arm.root.children.find((objectValue) => objectValue.isSkinnedMesh);
    assert.ok(surface.geometry.attributes.position.count > 2000);
    assert.ok(surface.geometry.index.count > 11000);

    for (let i = 0; i < surface.geometry.attributes.skinWeight.count; i++) {
      let total = 0;
      for (let j = 0; j < 4; j++) {
        total += surface.geometry.attributes.skinWeight.array[i * 4 + j];
      }
      assert.ok(Math.abs(total - 1) < 1e-5);
    }

    arm.root.position.set(3, 1.66, -8);
    arm.root.rotation.y = 0.7;

    for (const charge of [0, 0.5, 1]) {
      const pose = sampleBowPose(charge),
        roll = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), pose.roll),
        contact =
          side < 0
            ? pose.grip
            : pose.pull.clone().multiplyScalar(0.9).applyQuaternion(roll).add(pose.grip);
      poseArm(
        arm,
        new Vector3(side * 0.25, -0.45, 0.1),
        new Vector3(side * 0.35, -0.25, 0.05),
        contact,
        roll,
      );
      arm.root.updateMatrixWorld(true);
      surface.skeleton.update();
      const wrist = surface.skeleton.bones.find(
        (secondValue) => secondValue.name === 'wrist.' + (side < 0 ? 'L' : 'R'),
      );
      const actual = arm.root.worldToLocal(wrist.getWorldPosition(new Vector3()));
      assert.ok(
        actual.distanceTo(contact) > 0.07 && actual.distanceTo(contact) < 0.18,
        'wrist remains an anatomical palm length behind contact in transformed camera space',
      );

      for (let i = 0; i < surface.geometry.attributes.position.count; i += 17) {
        const point = new Vector3().fromBufferAttribute(surface.geometry.attributes.position, i);
        surface.applyBoneTransform(i, point);
        assert.ok(
          Number.isFinite(point.length()) && point.length() < 2,
          'skin remains bounded throughout draw',
        );
      }
    }
  }
});

test('right string fingers flex toward palm and open on release without reallocating arm geometry', async () => {
  const asset = JSON.parse(
    await readFile(
      new URL('../assets/bow-survivor/male-adult-rigged.json', import.meta.url),
      'utf8',
    ),
  );
  const arm = makeArm(firstPersonSkin(), 1);
  attachFirstPersonArm(arm, 1, asset);
  const surface = arm.root.children.find((objectValue) => objectValue.isSkinnedMesh),
    geometry = surface.geometry;

  const pose = () => {
    poseArm(
      arm,
      new Vector3(0.3, -0.3, 0.8),
      new Vector3(0.3, -0.2, 0.35),
      new Vector3(),
      new Quaternion(),
    );
    arm.root.updateMatrixWorld(true);
  };

  const bone = (name) =>
    surface.skeleton.bones.find((secondValue) => secondValue.name === name + '.R');

  const tip = () => {
    const secondValue = bone('finger3-3'),
      info = asset.bones.find((secondValue) => secondValue.name === 'finger3-3.R');

    return secondValue.localToWorld(
      new Vector3().fromArray(info.tail).sub(new Vector3().fromArray(info.head)),
    );
  };

  pose();
  const curled = tip().distanceTo(bone('wrist').getWorldPosition(new Vector3()));
  assert.ok(Number.isFinite(curled));
  const tipPoint = bone('finger3-3').getWorldPosition(new Vector3());
  assert.ok(
    tipPoint.distanceTo(bone('wrist').getWorldPosition(new Vector3())) < 0.25,
    'hook stays close to the palm',
  );
  arm.setFingerRelease(1);
  pose();
  assert.ok(
    tip().distanceTo(bone('wrist').getWorldPosition(new Vector3())) > curled + 0.04,
    'release opens the hook',
  );
  assert.equal(surface.geometry, geometry);
});

test('supplied first-ten-second clip preserves observed carry, nock, draw-cancel and true shot boundary', () => {
  assert.equal(sampleReferenceTimeline(0).arrowVisible, false);
  assert.equal(sampleReferenceTimeline(0).rightVisible, false);
  assert.equal(sampleReferenceTimeline(2.5).rightVisible, true);
  assert.equal(sampleReferenceTimeline(3.0).rightVisible, false);
  assert.equal(sampleReferenceTimeline(3.4).arrowVisible, true);
  assert.equal(
    sampleReferenceTimeline(3.7).arrowVisible,
    true,
    '3.7 is a draw cancel with the arrow still held',
  );
  assert.equal(sampleReferenceTimeline(8.45).arrowVisible, true);
  assert.equal(
    sampleReferenceTimeline(8.48).arrowVisible,
    false,
    'actual video shot is between 8.433 and 8.467 seconds',
  );
  assert.equal(sampleReferenceTimeline(9.6).rightVisible, true);
  assert.equal(
    sampleReferenceTimeline(8.5).rightVisible,
    false,
    'the source lower-frame shape at release is the player foot, not the string hand',
  );
  const live = sampleReferenceAction(1, -1, 1),
    reference = sampleReferenceTimeline(7.5);
  assert.deepEqual(live.grip, reference.grip);
  assert.deepEqual(live.rotation, reference.rotation);
  assert.equal(live.rightVisible, false);
});

test('reference arrow retains physical length and measured screen landmarks while sharing the rendered string nock', () => {
  const pose = sampleReferenceTimeline(3.4),
    arrow = referenceArrow(pose);
  assert.ok(Math.abs(arrow.tip.distanceTo(arrow.nock) - 0.9405) < 1e-9);
  const camera = new PerspectiveCamera(76, 16 / 9, 0.1, 200),
    tip = arrow.tip.clone().project(camera);
  assert.ok(Math.abs((tip.x + 1) / 2 - 0.5) < 0.001);
  assert.ok(Math.abs((1 - tip.y) / 2 - 0.5) < 0.001);
  const { game } = harness();
  game.state.bow = makeFieldBow();
  game.world.root.add(game.state.bow, game.state.heldArrow, game.state.arm, game.state.hand);
  game.inspect({ referenceTime: 3.4 });
  game.world.root.updateMatrixWorld(true);
  const string = game.state.bow.userData.bowString;
  const nock = string.localToWorld(
    new Vector3().fromBufferAttribute(string.geometry.attributes.position, 1),
  );
  const arrowNock = game.state.heldArrow.localToWorld(new Vector3(0, 0, 0.28));
  assert.ok(
    nock.distanceTo(arrowNock) < 1e-6,
    'held arrow and string meet during the same runtime update',
  );
});

test('the physical arrowhead is the full-draw sight and launches along its camera ray', () => {
  const visual = harness().game;
  visual.arrows.fire(new Vector3(), new Vector3(0, 0, -1), -1, 1);
  const model = visual.state.arrows[0].mesh;
  model.updateMatrixWorld(true);

  const extent = (mesh, fn) => {
    const point = mesh.geometry.getAttribute('position');

    return fn(
      ...Array.from(
        { length: point.count },
        (unusedValue, i) => mesh.localToWorld(new Vector3().fromBufferAttribute(point, i)).z,
      ),
    );
  };

  const shaftEnd = extent(model.children[0], Math.min),
    headBase = extent(model.children[1], Math.max);
  assert.ok(
    shaftEnd <= headBase && shaftEnd > headBase - 0.02,
    'wooden shaft joins the physical arrowhead without a visible gap',
  );

  for (const aspect of [16 / 9, 2479 / 1537]) {
    for (const aim of [false, true]) {
      const { game, mouse } = harness();
      game.state.bow = makeFieldBow();
      game.world.root.add(game.state.bow, game.state.heldArrow, game.state.arm, game.state.hand);
      const camera = game.viewer.scene.mainCamera;
      camera.aspect = aspect;
      game.inspect({ draw: 1, aim });
      game.world.root.updateMatrixWorld(true);
      camera.updateMatrixWorld(true);
      const head = game.state.heldArrow.localToWorld(new Vector3(0, 0, -0.765)),
        screen = head.clone().project(camera);
      assert.ok(
        Math.abs(screen.x) < 1e-6 && Math.abs(screen.y) < 1e-6,
        'rendered physical tip is screen center without an extra reticle',
      );
      game.state.preview = null;
      game.state.charge = 1;
      game.state.drawing = true;
      game.state.aimBlend = aim ? 1 : 0;
      game.playerController.onMouseUp(mouse(0));
      const arrow = game.state.arrows[0],
        expected = head.clone().sub(camera.position).normalize();
      assert.ok(
        arrow.position.distanceTo(head) < 1e-6,
        'projectile starts at the rendered arrowhead',
      );
      assert.ok(
        arrow.velocity.clone().normalize().distanceTo(expected) < 1e-6,
        'projectile direction is the visible tip ray',
      );
      game.arrows.step(0.1);
      assert.ok(
        arrow.velocity.y < expected.y * 55,
        'gravity lowers the visible flight after release',
      );
    }
  }
});

test('real collision audio routes headshots, body hits, cover and once-per-arrow near misses', () => {
  const setup = () => {
    const { game } = harness(),
      events = [];
    game.state.config.scoreLimit = 10;
    game.state.sounds = {
      release() {},
      setListener() {},
      impact(position, kind) {
        events.push(kind);
      },
      headshotConfirm() {
        events.push('confirmation');
      },
      whizz() {
        events.push('whizz');

        return true;
      },
    };

    return { game, events };
  };

  for (const [height, kind] of [
    [1.65, 'head'],
    [1.05, 'body'],
  ]) {
    const { game, events } = setup();
    game.state.bots = [game.bots.create(0)];
    game.state.bots[0].mesh.position.set(0, 0, -3);
    game.arrows.fire(new Vector3(0, height, 0), new Vector3(0, 0, -1), -1, 1);
    for (let i = 0; i < 15; i++) {
      game.arrows.step(1 / 120);
    }
    assert.ok(events.includes(kind));
    assert.equal(events.includes('confirmation'), kind === 'head');
    assert.equal(events.includes('whizz'), false);
  }

  const miss = setup();
  miss.game.arrows.fire(new Vector3(1, 1.6, -3), new Vector3(0, 0, 1), 0, 1);
  for (let i = 0; i < 8; i++) {
    miss.game.arrows.step(1 / 120);
  }
  assert.equal(miss.events.filter((eventValue) => eventValue === 'whizz').length, 1);
  const cover = setup();
  cover.game.state.player.x = 10;
  cover.game.state.config.obstacles = [{ x: 0, z: -0.3, r: 0.2, height: 3 }];
  cover.game.arrows.fire(new Vector3(0, 1.6, 0), new Vector3(0, 0, -1), 0, 1);
  cover.game.arrows.step(1 / 120);
  assert.deepEqual(cover.events, ['cover']);
});
