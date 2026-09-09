import {test,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');

test('hosted player enters the real arena and advances bot combat',async({page})=>{
  const consoleErrors=[];
  const pageErrors=[];
  page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
  page.on('pageerror',error=>pageErrors.push(error.message));

  await page.goto('/');
  await page.waitForFunction(()=>document.documentElement.dataset.playerReady==='true');
  const enter=page.getByRole('button',{name:'ENTER ARENA'});
  await expect(enter).toBeVisible();
  await expect(page.locator('#kite3d-bow-game-hud')).toContainText('00 / 10  ELIMINATIONS');
  const before=await page.evaluate(()=>window.__KITE_BOW_GAME__?.getState());
  expect(before?.bots).toHaveLength(3);

  await enter.click();
  await page.waitForTimeout(3500);
  const after=await page.evaluate(()=>window.__KITE_BOW_GAME__?.getState());
  expect(after?.bots).toHaveLength(3);
  expect(after?.elapsed).toBeGreaterThan(.3);
  const moved=after.bots.some((bot,index)=>{
    const prior=before.bots[index].position;
    return Math.hypot(bot.position.x-prior.x,bot.position.z-prior.z)>.25;
  });
  expect(moved).toBe(true);
  await expect(page.locator('#kite3d-bow-game-hud')).toBeVisible();
  const sceneStats=await page.evaluate(()=>{
    const arena=window.viewer.scene.getObjectByName('K3D_BOW_RUNTIME_ARENA');
    const stats={objects:0,meshes:0,instancedMeshes:0,instances:{}};
    arena?.traverse(object=>{
      stats.objects++;
      if(object.isMesh)stats.meshes++;
      if(object.isInstancedMesh){stats.instancedMeshes++;stats.instances[object.name]=object.count;}
    });
    return stats;
  });
  expect(sceneStats.instances).toEqual({
    'Detailed pine needle boughs':6720,
    'Tapered pine branches':1680,
    'Dry forest grasses':3400,
    'Forest scree':160,
  });

  const evidenceDir=resolve(root,'evidence');
  await mkdir(evidenceDir,{recursive:true});
  await page.locator('#bow-canvas').screenshot({path:resolve(evidenceDir,'solo-arena.png')});
  const log={
    url:page.url(),
    bots:after.bots.length,
    elapsed:after.elapsed,
    before:before.bots.map(bot=>bot.position),
    after:after.bots.map(bot=>bot.position),
    scoreText:await page.locator('#kite3d-bow-game-hud').locator('div').nth(2).textContent(),
    renderBatch:after.renderBatch,
    sceneStats,
    pointerLock:await page.evaluate(()=>document.pointerLockElement?.id??null),
    consoleErrors,
    pageErrors,
  };
  await writeFile(resolve(evidenceDir,'e2e-run.json'),JSON.stringify(log,null,2)+'\n');
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
