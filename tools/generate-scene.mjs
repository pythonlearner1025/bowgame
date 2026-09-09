/** Generates the serialized Threepipe scene from authored component metadata. */
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const browserModule = await build({
  stdin: {
    contents: `
      import {Group,GLTFExporter} from 'threepipe';
      window.generateBowScene=async()=>{
        const arena=new Group();
        arena.name='K3D_BOW_DEMO_ARENA';
        arena.userData.EntityComponentPlugin={
          'bow-game':{type:'BowGameComponent',state:{botCount:3,scoreLimit:10,difficulty:'normal'}}
        };
        arena.userData.kite3dBowArena={runtimeOnly:true,seed:'BowArena.seededRandom:73429'};
        const result=await new GLTFExporter().parseAsync(arena,{binary:true});
        const blob=new Blob([result],{type:'model/gltf-binary'});
        const link=document.createElement('a');
        link.download='main.scene.glb';
        link.href=URL.createObjectURL(blob);
        document.body.append(link);
        link.click();
        setTimeout(()=>URL.revokeObjectURL(link.href),1000);
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

try {
  const page = await browser.newPage();
  await page.setContent('<!doctype html><title>Bow scene generator</title>');
  await page.addScriptTag({ content: browserModule.outputFiles[0].text });
  const downloadPromise = page.waitForEvent('download');
  await page.evaluate(() => window.generateBowScene());
  const download = await downloadPromise;
  const target = resolve(root, 'assets/main.scene.glb');
  await download.saveAs(target);
  console.log(`generated ${target} with public Threepipe GLTFExporter in Chromium`);
} finally {
  await browser.close();
}
