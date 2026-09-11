/** Verifies the complete emitted module graph and rejects obsolete or remote runtime paths. */
import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';
import { init, parse } from 'es-module-lexer';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageManifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const allowedBareImports = new Set(['three', 'threepipe', '@blitzdev/engine']);
const entries = [...packageManifest.kite3d.scripts, packageManifest.main];
const pending = entries.map((entry) => resolve(root, entry));
const visited = new Set();
let importCount = 0;
await init;

async function assertMissing(path) {
  try {
    await stat(resolve(root, path));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return;
    }
    throw error;
  }

  throw new Error(`obsolete Kite-incompatible path remains: ${path}`);
}

while (pending.length) {
  const path = pending.pop();
  if (!path || visited.has(path)) {
    continue;
  }
  visited.add(path);
  const source = await readFile(path, 'utf8');
  const projectPath = relative(root, path).replaceAll('\\', '/');
  await transform(source, { loader: 'js', format: 'esm', target: 'es2022' });

  assert.ok(!source.includes('/kite/assets'), `${projectPath}: legacy raw asset path`);
  assert.ok(!source.includes("three-mesh-bvh'"), `${projectPath}: bare BVH import`);
  assert.ok(!source.includes('three-mesh-bvh"'), `${projectPath}: bare BVH import`);
  assert.ok(!/https?:\/\/(?:esm\.sh|unpkg\.com|cdn\.jsdelivr\.net)/i.test(source));

  const [parsedImports] = parse(source);
  const specifiers = parsedImports
    .map((parsedImport) => parsedImport.specifier)
    .filter((specifier) => typeof specifier === 'string');

  for (const specifier of specifiers) {
    importCount++;
    if (specifier.endsWith('.ts')) {
      throw new Error(`${projectPath}: TypeScript import remains: ${specifier}`);
    }
    if (!specifier.startsWith('.') && !allowedBareImports.has(specifier)) {
      throw new Error(`${projectPath}: unsupported bare import ${specifier}`);
    }
    if (!specifier.startsWith('.')) {
      continue;
    }
    if (!specifier.endsWith('.js')) {
      throw new Error(`${projectPath}: relative import needs emitted .js suffix: ${specifier}`);
    }
    const importedPath = resolve(dirname(path), specifier);
    await stat(importedPath).catch(() => {
      throw new Error(`${projectPath}: missing relative import ${relative(root, importedPath)}`);
    });
    pending.push(importedPath);
  }
}

const emittedFiles = (await readdir(resolve(root, 'scripts')))
  .filter((filename) => filename.endsWith('.js'))
  .map((filename) => `scripts/${filename}`)
  .sort();
const visitedScripts = [...visited]
  .map((path) => relative(root, path).replaceAll('\\', '/'))
  .filter((path) => path.startsWith('scripts/'))
  .sort();
assert.deepEqual(visitedScripts, emittedFiles, 'every emitted script is reachable from the entry');
assert.ok(
  visited.has(resolve(root, 'vendor/three-mesh-bvh-0.9.5/index.module.js')),
  'component graph uses the pinned local BVH module',
);

await assertMissing('player');
await assertMissing('vite.config.ts');
await assertMissing('dist');

console.log(
  `verified ${visitedScripts.length} emitted modules and ${importCount} imports; ` +
    `bare imports=${[...allowedBareImports].join(', ')}`,
);
