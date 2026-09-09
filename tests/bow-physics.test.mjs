/** Specifies projectile, cover, damage, and movement formulas. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
const bundled = await build({
  entryPoints: [new URL('../src/BowPhysics.ts', import.meta.url).pathname],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
});
const { shotSpeed, shotDamage, segmentSphere, segmentCover, moveWithCover, GRAVITY } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
);
test('draw scales velocity and lethal headshots without unbounded charge', () => {
  assert.equal(shotSpeed(0), 18);
  assert.equal(shotSpeed(1), 56);
  assert.equal(shotSpeed(2), 56);
  assert.equal(shotDamage(1), 70);
  assert.equal(shotDamage(1, true), 126);
});
test('fast arrow swept collision hits a target between frame endpoints', () => {
  const time = segmentSphere(
    { x: 0, y: 1, z: 0 },
    { x: 0, y: 1, z: -12 },
    { x: 0, y: 1, z: -6 },
    0.4,
  );
  assert.ok(time > 0 && time < 1);
  assert.equal(
    segmentSphere({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: -12 }, { x: 2, y: 1, z: -6 }, 0.4),
    null,
  );
});
test('cover blocks an arrow before the target but allows shooting over it', () => {
  const firstValue = { x: 0, y: 1, z: 0 },
    secondValue = { x: 0, y: 1, z: -10 },
    candidate = { x: 0, z: -3, r: 1, height: 2 };
  assert.ok(
    segmentCover(firstValue, secondValue, candidate) <
      segmentSphere(firstValue, secondValue, { x: 0, y: 1, z: -7 }, 0.4),
  );
  assert.equal(segmentCover({ ...firstValue, y: 3 }, { ...secondValue, y: 3 }, candidate), null);
  assert.equal(segmentCover({ x: 0, y: 3, z: -3 }, { x: 0, y: 1, z: -3 }, candidate), 0.5);
});
test('movement slides out of cover and respects arena boundary', () => {
  const point = moveWithCover({ x: 0, y: 0, z: 0 }, 1, 0, [{ x: 1, z: 0, r: 1, height: 2 }]);
  assert.ok(Math.hypot(point.x - 1, point.z) >= 1.379);
  const edge = moveWithCover({ x: 26, y: 0, z: 0 }, 4, 0, []);
  assert.equal(edge.x, 27);
});
test('ballistic drop and swept impact resolve a full-charge hit at 20m', () => {
  let point = { x: 0, y: 1.6, z: 0 };
  const value = { x: 0, y: GRAVITY * 0.5 * (20 / 56), z: -56 };
  let hit = false;

  for (let i = 0; i < 60; i++) {
    value.y -= GRAVITY / 120;
    const quaternion = { x: 0, y: point.y + value.y / 120, z: point.z + value.z / 120 };
    if (segmentSphere(point, quaternion, { x: 0, y: 1.6, z: -20 }, 0.24) !== null) {
      hit = true;
    }
    point = quaternion;
  }

  assert.ok(hit);
  assert.ok(point.y < 1.6);
});
