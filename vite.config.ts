/** Bundles the standalone player and rejects accidental remote runtime dependencies. */
import { defineConfig, type Plugin } from 'vite';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(fileURLToPath(import.meta.url));
const assetsRoot = resolve(projectRoot, 'assets');
const runtimeAssets = new Set([
  'main.scene.glb',
  'bow-audio/release-recorded.wav',
  'bow-audio/whizz-recorded.wav',
  'bow-survivor/eyes-brown.png',
  'bow-survivor/male-adult-rigged.json',
  'bow-survivor/skin-male.png',
]);

function bundledProjectAssets(): Plugin {
  return {
    name: 'kite-project-assets',
    async buildStart() {
      const visit = async (directory: string) => {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          const path = resolve(directory, entry.name);

          if (entry.isDirectory()) {
            await visit(path);
          } else {
            const assetPath = relative(assetsRoot, path).replaceAll('\\', '/');
            if (runtimeAssets.has(assetPath)) {
              this.emitFile({
                type: 'asset',
                fileName: `kite/assets/${assetPath}`,
                source: await readFile(path),
              });
            }
          }
        }
      };

      await visit(assetsRoot);
    },
  };
}

function localOnlyDependencies(): Plugin {
  // Matches remote CDN host fragments that must never survive in emitted JavaScript.
  const forbidden = /(?:esm\.sh|unpkg|cdn)/i;

  return {
    name: 'local-only-dependencies',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('/threepipe/lib/index.js')) {
        return;
      }

      return code
        .replaceAll('https://cdn.jsdelivr.net/', '/kite/local-third-party/')
        .replaceAll('https://unpkg.com/', '/kite/local-third-party/')
        .replaceAll('https://cdn.tailwindcss.com', '/kite/local-third-party/tailwindcss.js')
        .replaceAll('CDN', 'LOCAL_SOURCE');
    },
    generateBundle(_options, bundle) {
      for (const [name, item] of Object.entries(bundle)) {
        let source = '';

        if (item.type === 'chunk') {
          source = item.code;
        } else if (typeof item.source === 'string') {
          source = item.source;
        }

        const match = forbidden.exec(source);
        if (match) {
          throw new Error(
            `${name} contains a forbidden remote dependency reference: ${source.slice(Math.max(0, match.index - 80), match.index + 120)}`,
          );
        }
      }
    },
  };
}

export default defineConfig({
  root: resolve(projectRoot, 'player'),
  publicDir: false,
  plugins: [localOnlyDependencies(), bundledProjectAssets()],
  build: {
    outDir: resolve(projectRoot, 'dist'),
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2022',
  },
});
