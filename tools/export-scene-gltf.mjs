/**
 * Exports the runtime arena to one self-contained glTF JSON file for inspection in external
 * viewers. It does not export textures, the invisible boundary barrier, or gameplay state.
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bundlePath = resolve(root, '.bow-export-scene.mjs');
const outputPath = resolve(root, 'evidence/bow-arena.gltf');

// The base64 data URI prefix that glTF expects for an embedded binary buffer.
const OCTET_STREAM_DATA_URI_PREFIX = 'data:application/octet-stream;base64,';

// The arena builder paints procedural textures on canvases. Node has no canvas, so painting is
// inert here, exactly as in the Node test suite; geometry and seeded randomness are unchanged.
function installBrowserStubs() {
  const context = new Proxy(
    {
      createRadialGradient() {
        return { addColorStop() {} };
      },
    },
    {
      get: (target, key) => target[key] ?? (() => {}),
      set: (target, key, value) => {
        target[key] = value;

        return true;
      },
    },
  );
  globalThis.ImageData ??= class {};
  globalThis.document = {
    createElement() {
      return {
        getContext() {
          return context;
        },
      };
    },
  };
  // The three.js exporter converts its buffer blob to a data URI through a browser FileReader.
  globalThis.FileReader ??= class {
    result = null;
    onloadend = null;

    readAsDataURL(blob) {
      blob.arrayBuffer().then((buffer) => {
        this.result = OCTET_STREAM_DATA_URI_PREFIX + Buffer.from(buffer).toString('base64');
        this.onloadend?.();
      });
    }
  };
}

// Replaces textured materials with plain colored copies so the export needs no image encoding.
function stripTextures(rootObject, MeshStandardMaterial) {
  const replacements = new Map();

  rootObject.traverse((object) => {
    if (!object.isMesh) {
      return;
    }

    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const stripped = materials.map((material) => {
      if (!replacements.has(material)) {
        replacements.set(
          material,
          new MeshStandardMaterial({
            name: material.name,
            color: material.color,
            roughness: material.roughness,
            metalness: material.metalness,
            side: material.side,
            flatShading: material.flatShading,
            vertexColors: material.vertexColors,
            transparent: material.transparent,
            opacity: material.opacity,
          }),
        );
      }

      return replacements.get(material);
    });
    object.material = Array.isArray(object.material) ? stripped : stripped[0];
  });
}

function exportToJson(scene, GLTFExporter) {
  return new Promise((resolveJson, rejectJson) => {
    new GLTFExporter().parse(scene, resolveJson, rejectJson, {
      binary: false,
      onlyVisible: true,
      trs: true,
    });
  });
}

// The bundle aliases the engine barrel to plain three so the arena builds in Node.
const bundled = await build({
  stdin: {
    contents: [
      "export { buildBowArena } from './src/BowArena.ts';",
      "export { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';",
      "export { MeshStandardMaterial } from 'three';",
    ].join('\n'),
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  plugins: [
    {
      name: 'three-only',
      setup(pluginBuild) {
        pluginBuild.onResolve({ filter: /^threepipe$/ }, () => ({
          path: resolve(root, 'node_modules/three/build/three.module.js'),
        }));
      },
    },
  ],
});
await writeFile(bundlePath, bundled.outputFiles[0].text);

try {
  // Stubs must exist before the bundle loads because three.js references browser globals at import.
  installBrowserStubs();
  const { buildBowArena, GLTFExporter, MeshStandardMaterial } = await import(
    pathToFileURL(bundlePath).href
  );
  const arena = buildBowArena();
  stripTextures(arena.group, MeshStandardMaterial);
  const gltf = await exportToJson(arena.group, GLTFExporter);
  const text = JSON.stringify(gltf);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, text);
  const instancedNodes = gltf.nodes.filter(
    (node) => node.extensions?.EXT_mesh_gpu_instancing !== undefined,
  ).length;
  console.log(
    `exported glTF ${gltf.asset.version}: ${text.length} bytes, ${gltf.nodes.length} nodes, ` +
      `${gltf.meshes.length} meshes, ${gltf.materials.length} materials, ` +
      `${instancedNodes} instanced nodes`,
  );
  console.log(outputPath);
} finally {
  await rm(bundlePath, { force: true });
  delete globalThis.document;
}
