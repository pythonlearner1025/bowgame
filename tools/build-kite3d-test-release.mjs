/** Builds and audits a local fixture with the same file layout as Kite3D publication. */
import { projectDependencies } from '@blitzdev/engine/importMap';
import {
  NodeProjectDirectory,
  buildManifest,
  generateIndexHtml,
  sha256,
  walkProject,
} from 'kite3d';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RUNTIME_HASH_PREVIEW_LENGTH = 12;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = resolve(root, '.kite3d/e2e-release');
const manifestPath = resolve(root, '.kite3d/e2e-release-manifest.json');
const packageManifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const configuredExcludes = packageManifest.kite3d?.publish?.exclude;

if (
  !Array.isArray(configuredExcludes) ||
  configuredExcludes.some((value) => typeof value !== 'string')
) {
  throw new Error('package.json kite3d.publish.exclude must be an array of strings');
}

const directory = new NodeProjectDirectory(root);
let entries = await walkProject(directory.asHandle(), { exclude: configuredExcludes });
const publishedPackage = { ...packageManifest };
delete publishedPackage.devDependencies;
delete publishedPackage.dependencies;
delete publishedPackage.peerDependencies;
delete publishedPackage.optionalDependencies;
const packageFile = new File([`${JSON.stringify(publishedPackage, null, 2)}\n`], 'package.json', {
  type: 'application/json',
});
const runtimeFile = new File(
  [await readFile(resolve(root, 'node_modules/@blitzdev/engine/dist/runtime.js'))],
  'runtime.js',
  { type: 'text/javascript' },
);
const runtimeHash = await sha256(runtimeFile);
const indexHtml = generateIndexHtml({
  name: packageManifest.kite3d.name,
  version: packageManifest.kite3d.version,
  runtimeHash,
  dependencies: projectDependencies(publishedPackage),
});
const indexFile = new File([indexHtml], 'index.html', { type: 'text/html' });
entries = entries.filter((entry) => !['package.json', 'index.html'].includes(entry.path));
entries.push({ path: 'package.json', file: packageFile });
entries.push({ path: 'index.html', file: indexFile });
entries.push({ path: '_blitz/runtime.js', file: runtimeFile });
entries.sort((left, right) => left.path.localeCompare(right.path));

const forbiddenPaths = entries.filter(({ path }) => {
  const pathSegments = path.toLowerCase().split('/');
  const topLevelName = pathSegments[0];
  const filename = pathSegments.at(-1) ?? '';
  const hasForbiddenDirectory = ['src', 'tests', 'tools', 'evidence', 'worker'].includes(
    topLevelName,
  );
  const isWranglerFile = filename.startsWith('wrangler');
  const isDeclaration = filename.endsWith('.d.ts');
  const isTypeScriptConfig = filename.startsWith('tsconfig') && filename.endsWith('.json');
  const isViteFile = filename === 'vite' || filename.startsWith('vite.');

  return (
    hasForbiddenDirectory || isWranglerFile || isDeclaration || isTypeScriptConfig || isViteFile
  );
});

if (forbiddenPaths.length) {
  throw new Error(`forbidden release files: ${forbiddenPaths.map(({ path }) => path).join(', ')}`);
}

// Kite's generated template emits the import map as compact JSON in one script element.
const importMapMatch = indexHtml.match(/<script type="importmap">([^<]+)<\/script>/);
if (!importMapMatch) {
  throw new Error('generated release HTML has no import map');
}
const importMap = JSON.parse(importMapMatch[1]);
for (const [specifier, value] of Object.entries(importMap.imports)) {
  if (/^https?:\/\//i.test(value)) {
    throw new Error(`remote import-map value for ${specifier}: ${value}`);
  }
  if (value !== './_blitz/runtime.js') {
    throw new Error(`unexpected runtime import-map value for ${specifier}: ${value}`);
  }
}

await rm(outputRoot, { recursive: true, force: true });
for (const entry of entries) {
  const outputPath = resolve(outputRoot, entry.path);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, new Uint8Array(await entry.file.arrayBuffer()));
}

const releaseManifest = await buildManifest(entries);
await mkdir(dirname(manifestPath), { recursive: true });
await writeFile(
  manifestPath,
  `${JSON.stringify({ ...releaseManifest, importMap: importMap.imports }, null, 2)}\n`,
);

console.log(
  `built audited Kite3D release fixture with ${entries.length} files; ` +
    `runtime=${runtimeHash.slice(0, RUNTIME_HASH_PREVIEW_LENGTH)}; ` +
    `imports=${Object.keys(importMap.imports).length}`,
);
