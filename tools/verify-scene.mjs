/** Verifies scene packaging facts that are outside Kite's semantic checks. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scene = JSON.parse(await readFile(resolve(root, 'assets/main.scene.gltf'), 'utf8'));
const binary = await readFile(resolve(root, 'assets/main.scene.bin'));
const packageManifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));

assert.equal(packageManifest.mainScene, 'assets/main.scene.gltf');
assert.equal(scene.buffers.length, 1);
assert.equal(scene.buffers[0].uri, 'main.scene.bin');
assert.equal(scene.buffers[0].byteLength, binary.length);

const externalResources = [...scene.buffers, ...(scene.images ?? [])];
for (const resource of externalResources) {
  if (resource.uri === undefined) {
    continue;
  }

  // Reject data, root-relative, and scheme-prefixed URIs; only sibling project files are valid.
  const forbiddenUriPattern = /^(?:data:|\/|[a-z]+:)/i;
  assert.ok(!forbiddenUriPattern.test(resource.uri), `portable resource URI: ${resource.uri}`);
  assert.ok(!resource.uri.includes('..'), `contained resource URI: ${resource.uri}`);
}

console.log(`verified scene packaging: ${scene.buffers[0].uri}, ${binary.length} binary bytes`);
