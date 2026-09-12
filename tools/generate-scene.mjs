/** Generates the deterministic authored preview scene and external binary buffer. */
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scenePath = resolve(root, 'assets/main.scene.gltf');
const binaryPath = resolve(root, 'assets/main.scene.bin');
const manifestPath = resolve(root, 'assets.json');
const temporarySuffix = '.new';

// Three's module initializes a default texture while the Node-side serializer is imported.
globalThis.ImageData ??= class ImageData {};
globalThis.window ??= globalThis;
globalThis.addEventListener ??= () => {};
globalThis.removeEventListener ??= () => {};
const { serializeSceneGltfDocument } = await import('@blitzdev/engine');

const browserModule = await build({
  stdin: {
    contents: `
      import {BoxGeometry,GLTFExporter2,Group,Mesh,MeshBasicMaterial} from 'threepipe';
      window.generateBowScene=async()=>{
        const modelRoot=new Group();
        modelRoot.name='Scene';
        modelRoot.userData.rootSceneModelRoot=true;

        const arena=new Group();
        arena.name='K3D_BOW_DEMO_ARENA';
        arena.uuid='88e34e12-5619-4a74-8677-680775c83c31';
        arena.userData.gltfUUID=arena.uuid;
        arena.userData.EntityComponentPlugin={
          '4d3c5fa2-bef9-48cc-8b39-2fe8d128bf3c':{
            type:'BowGameComponent',
            state:{botCount:3,scoreLimit:10,difficulty:'normal'},
          },
        };
        arena.userData.kite3dAuthoring={role:'direct',id:'bow-demo-arena'};
        arena.userData.kite3dBowArena={runtimeOnly:true,seed:'BowArena.seededRandom:73429'};

        const preview=new Group();
        preview.name='K3D_BOW_STOPPED_PREVIEW';
        preview.uuid='16f52afd-b9b3-48cd-a148-53b8fd7d2ef2';
        preview.userData.gltfUUID=preview.uuid;

        const floor=new Mesh(
          new BoxGeometry(6,0.2,6),
          new MeshBasicMaterial({color:0x58645c}),
        );
        floor.name='K3D_BOW_PREVIEW_FLOOR';
        floor.uuid='eb5a9be8-f0af-454c-b07a-ce7a284883d5';
        floor.userData.gltfUUID=floor.uuid;
        floor.position.set(0,-0.1,0);
        preview.add(floor);

        const target=new Mesh(
          new BoxGeometry(1.6,1.6,0.15),
          new MeshBasicMaterial({color:0xa53d2e}),
        );
        target.name='K3D_BOW_PREVIEW_TARGET';
        target.uuid='450f32f1-c23f-44a8-9789-52e163983612';
        target.userData.gltfUUID=target.uuid;
        target.position.set(0,1.2,0);
        preview.add(target);
        arena.add(preview);
        modelRoot.add(arena);

        const exported=await new GLTFExporter2().parseAsync(modelRoot,{
          exportExt:'gltf',
          preserveUUIDs:true,
          onlyVisible:true,
        });
        return JSON.parse(await exported.text());
      };
    `,
    resolveDir: root,
    loader: 'js',
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  logLevel: 'warning',
});

const browser = await chromium.launch({ headless: true });
let browserDocument;

try {
  const page = await browser.newPage();
  await page.setContent('<!doctype html><title>Bow scene generator</title>');
  await page.addScriptTag({ content: browserModule.outputFiles[0].text });
  browserDocument = await page.evaluate(() => window.generateBowScene());
} finally {
  await browser.close();
}

const serialized = await serializeSceneGltfDocument(browserDocument, {
  scenePath: 'assets/main.scene.gltf',
});
const binary = serialized.files.find((file) => file.path === 'assets/main.scene.bin');

if (!binary) {
  throw new Error('Scene serializer did not produce assets/main.scene.bin');
}

await writeFile(`${scenePath}${temporarySuffix}`, serialized.gltf);
await writeFile(`${binaryPath}${temporarySuffix}`, binary.bytes);
await rename(`${scenePath}${temporarySuffix}`, scenePath);
await rename(`${binaryPath}${temporarySuffix}`, binaryPath);

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
delete manifest.files['main.scene.glb'];
manifest.files['main.scene.gltf'] = {
  path: 'assets/main.scene.gltf',
  sha256: createHash('sha256').update(serialized.gltf).digest('hex'),
  mime: 'model/gltf+json',
};
manifest.files['main.scene.bin'] = {
  path: 'assets/main.scene.bin',
  sha256: createHash('sha256').update(binary.bytes).digest('hex'),
  mime: 'application/octet-stream',
};
await writeFile(`${manifestPath}${temporarySuffix}`, `${JSON.stringify(manifest, null, 2)}\n`);
await rename(`${manifestPath}${temporarySuffix}`, manifestPath);

console.log(
  `generated assets/main.scene.gltf (${serialized.gltf.length} bytes) and ` +
    `assets/main.scene.bin (${binary.bytes.length} bytes)`,
);
