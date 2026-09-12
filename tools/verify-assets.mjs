/** Verifies the complete runtime asset inventory and pinned local BVH artifact. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assetsRoot = resolve(root, 'assets');
const manifest = JSON.parse(await readFile(resolve(root, 'assets.json'), 'utf8'));
const expectedRawAssets = [
  'bow-audio/release-recorded.wav',
  'bow-audio/whizz-recorded.wav',
  'bow-survivor/male-adult-rigged.json',
  'bow-survivor/skin-male.png',
  'bow-survivor/eyes-brown.png',
];
const EXPECTED_BVH_SHA256 = 'c6ea2189f8d5c84a11de15bb333001f5630d0982c7a2edc5e85604162eba1a4e';

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(path)));
    } else {
      files.push(relative(assetsRoot, path).replaceAll('\\', '/'));
    }
  }

  return files;
}

for (const [id, entry] of Object.entries(manifest.files)) {
  assert.equal(entry.path, `assets/${id}`, `${id} has a repository-relative manifest path`);
  const bytes = await readFile(resolve(root, entry.path));
  const digest = createHash('sha256').update(bytes).digest('hex');
  assert.equal(digest, entry.sha256, `${id} hash`);
}

const manifestFiles = Object.keys(manifest.files).sort();
const actualFiles = (await listFiles(assetsRoot)).sort();
assert.deepEqual(manifestFiles, actualFiles, 'assets.json tracks every file below assets/');

for (const path of expectedRawAssets) {
  assert.ok(manifest.files[path], `raw browser asset is tracked: ${path}`);
}

const scene = JSON.parse(await readFile(resolve(assetsRoot, 'main.scene.gltf'), 'utf8'));
const sceneBinary = await readFile(resolve(assetsRoot, 'main.scene.bin'));
assert.equal(scene.buffers[0].uri, 'main.scene.bin');
assert.equal(scene.buffers[0].byteLength, sceneBinary.length, 'scene buffer length');

const vendorRoot = resolve(root, 'vendor/three-mesh-bvh-0.9.5');
const vendorJavaScript = await readFile(resolve(vendorRoot, 'index.module.js'));
const vendorLicense = await readFile(resolve(vendorRoot, 'LICENSE'));
const installedLicense = await readFile(resolve(root, 'node_modules/three-mesh-bvh/LICENSE'));
assert.equal(
  createHash('sha256').update(vendorJavaScript).digest('hex'),
  EXPECTED_BVH_SHA256,
  'vendored BVH JavaScript hash',
);
assert.equal(Buffer.compare(vendorLicense, installedLicense), 0, 'vendored BVH license bytes');
assert.ok(
  !vendorJavaScript.includes('sourceMappingURL'),
  'vendored BVH has no dangling source map',
);

console.log(
  `verified ${manifestFiles.length} complete asset records, ${expectedRawAssets.length} raw ` +
    `browser assets, and three-mesh-bvh@0.9.5 (${vendorJavaScript.length} bytes)`,
);
