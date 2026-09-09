/** Verifies compiled browser scripts contain required local modules and no remote imports. */
import { readFile, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entries = [
  'ArrowSystem.js',
  'BotSystem.js',
  'BowCollision.js',
  'BowArena.js',
  'BowArrowTrail.js',
  'BowAudio.js',
  'BowController.js',
  'BowGameComponent.script.js',
  'BowGameRuntime.js',
  'BowHandPose.js',
  'BowHandRig.js',
  'BowHumanAsset.js',
  'BowPlayerName.js',
  'BowPerformance.js',
  'BowPhysics.js',
  'BowReferenceClip.js',
  'BowSceneBatch.js',
  'BowVisuals.js',
  'CombatRules.js',
  'EntryOverlay.js',
  'GameState.js',
  'GameWorld.js',
  'Hud.js',
  'NetworkGlue.js',
  'PlayerController.js',
  'RemotePlayers.js',
];
let imports = 0;

for (const filename of entries) {
  const path = join(root, 'scripts', filename);
  const source = await readFile(path, 'utf8');
  await transform(source, { loader: 'js', format: 'esm', target: 'es2022' });
  if (/(?:from\s*|import\s*)['"][^'"]+\.ts['"]/.test(source)) {
    throw new Error(`${filename}: TypeScript import remains`);
  }
  const specifiers = [...source.matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g)].map(
    (match) => match[1],
  );

  for (const specifier of specifiers) {
    imports++;
    if (['threepipe', 'three', 'three-mesh-bvh'].includes(specifier)) {
      continue;
    }
    if (!/^\.\/.+\.js$/.test(specifier)) {
      throw new Error(`${filename}: unsupported import ${specifier}`);
    }
    const imported = resolve(dirname(path), specifier);
    await stat(imported).catch(() => {
      throw new Error(`${filename}: missing relative import ${relative(root, imported)}`);
    });
  }
}

console.log(
  `verified ${entries.length} raw ESM scripts (${imports} imports; allowed bare imports: threepipe, three, three-mesh-bvh)`,
);
