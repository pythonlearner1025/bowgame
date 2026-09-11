/** Specifies bounded telemetry storage, UTF-8 accounting, and frame-time summaries. */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const result = await build({
  stdin: {
    contents: `export {batchBowScene} from './src/BowSceneBatch.ts';export {Group,Mesh,InstancedMesh,BoxGeometry,MeshStandardMaterial,Matrix4} from 'threepipe';`,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  plugins: [
    {
      name: 'three',
      setup(secondValue) {
        secondValue.onResolve({ filter: /^threepipe$/ }, () => ({
          path: new URL('../node_modules/three/build/three.module.js', import.meta.url).pathname,
        }));
      },
    },
  ],
});
const temporary = await mkdtemp(join(tmpdir(), 'kite3d-batch-'));
after(() => rm(temporary, { recursive: true, force: true }));
await writeFile(join(temporary, 'test.mjs'), result.outputFiles[0].text);
globalThis.ImageData ??= class {};
const { batchBowScene, Group, Mesh, InstancedMesh, BoxGeometry, MeshStandardMaterial, Matrix4 } =
  await import(pathToFileURL(join(temporary, 'test.mjs')));
test('static batching preserves world transforms and restores authored mesh state without disposing shared resources', () => {
  const scene = new Group(),
    arena = new Group(),
    runtime = new Group(),
    geometry = new BoxGeometry(),
    material = new MeshStandardMaterial();
  scene.add(arena, runtime);
  arena.position.set(2, 0, 3);
  arena.rotation.y = 0.3;
  const originals = [0, 1, 2].map((x) => {
    const mesh = new Mesh(geometry, material);
    mesh.position.x = x;
    mesh.scale.set(1 + x, 0.7, 2);
    arena.add(mesh);

    return mesh;
  });
  originals[2].visible = false;
  scene.updateMatrixWorld(true);
  const before = originals.map((matrixValue) => matrixValue.matrixWorld.clone());
  let disposed = 0;
  geometry.addEventListener('dispose', () => disposed++);
  material.addEventListener('dispose', () => disposed++);
  const handle = batchBowScene(arena, runtime);
  assert.equal(handle.originalMeshes, 2);
  assert.equal(handle.batches, 1);
  const batch = runtime.children[0];
  runtime.updateMatrixWorld(true);

  for (let i = 0; i < 2; i++) {
    const actual = new Matrix4();
    batch.getMatrixAt(i, actual);
    actual.premultiply(batch.matrixWorld);
    actual.elements.forEach((value, k) =>
      assert.ok(Math.abs(value - before[i].elements[k]) < 1e-6),
    );
    assert.equal(originals[i].visible, false);
  }

  handle.dispose();
  assert.equal(runtime.children.length, 0);
  assert.equal(disposed, 0);
  assert.equal(originals[0].visible, true);
  assert.equal(originals[0].matrixAutoUpdate, true);
  assert.equal(originals[2].visible, false);
});
test('small pebble LOD is temporary and leaves persistent geometry intact', () => {
  const arena = new Group(),
    runtime = new Group(),
    original = new BoxGeometry(),
    pebbles = new InstancedMesh(original, new MeshStandardMaterial(), 1);
  pebbles.name = 'Forest scree';
  arena.add(pebbles);
  let disposed = 0;
  original.addEventListener('dispose', () => disposed++);
  const handle = batchBowScene(arena, runtime);
  assert.notEqual(pebbles.geometry, original);
  handle.dispose();
  assert.equal(pebbles.geometry, original);
  assert.equal(disposed, 0);
});
