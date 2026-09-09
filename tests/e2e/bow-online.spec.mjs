import {test,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),baseURL=process.env.BOWGAME_BASE_URL,mode=process.env.BOWGAME_EVIDENCE_MODE??'local';
const wsBase=baseURL.replace(/^http/,'ws');

class SocketProbe {
  messages=[];waiters=[];
  constructor(url){this.socket=new WebSocket(url);this.socket.addEventListener('message',event=>{const message=JSON.parse(String(event.data));this.messages.push(message);for(const waiter of [...this.waiters])if(waiter.type===message.type){this.waiters.splice(this.waiters.indexOf(waiter),1);waiter.resolve(message);}});}
  opened(){return new Promise((resolve,reject)=>{if(this.socket.readyState===WebSocket.OPEN)return resolve();this.socket.addEventListener('open',resolve,{once:true});this.socket.addEventListener('error',()=>reject(new Error('socket failed to open')),{once:true});});}
  waitFor(type,timeout=10_000){const found=this.messages.find(message=>message.type===type);if(found)return Promise.resolve(found);return new Promise((resolve,reject)=>{const waiter={type,resolve};this.waiters.push(waiter);setTimeout(()=>{const index=this.waiters.indexOf(waiter);if(index>=0)this.waiters.splice(index,1);reject(new Error(`timed out waiting for ${type}`));},timeout);});}
  send(value){this.socket.send(JSON.stringify(value));}
  close(){this.socket.close();}
}

async function enterOnline(page,name,errors){
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/?online=1');await page.waitForFunction(()=>document.documentElement.dataset.playerReady==='true');
  await page.waitForFunction(()=>window.__KITE_BOW_GAME__?.getState()?.network?.status==='connected',{timeout:30_000});
  const input=page.locator('input[aria-label="Archer name"]');await expect(input).toHaveCount(1);await input.evaluate((element,value)=>{element.value=value;},name);
  await page.evaluate(value=>{window.__KITE_BOW_SESSION__.setName(value);window.__KITE_BOW_GAME__.runtime.enter();},name);
}

test('two Chromium pages play, room limits hold, and rounds reset',async({browser})=>{
  const context=await browser.newContext({viewport:{width:1280,height:720}}),pageA=await context.newPage(),pageB=await context.newPage(),errors=[];
  await enterOnline(pageA,'Archer-A',errors);await pageA.evaluate(()=>window.viewer.timeline.stop());await enterOnline(pageB,'Archer-B',errors);
  await Promise.all([pageA.waitForFunction(()=>window.__KITE_BOW_GAME__?.getState()?.remotePlayers?.length===1),pageB.waitForFunction(()=>window.__KITE_BOW_GAME__?.getState()?.remotePlayers?.length===1)]);
  const beforeA=await pageA.evaluate(()=>window.__KITE_BOW_GAME__.getState()),beforeB=await pageB.evaluate(()=>window.__KITE_BOW_GAME__.getState());
  expect(beforeA.bots).toHaveLength(0);expect(beforeB.bots).toHaveLength(0);expect(beforeA.remotePlayers).toHaveLength(1);expect(beforeB.remotePlayers).toHaveLength(1);
  const aId=beforeA.player.id,bId=beforeB.player.id;expect(aId).toBeTruthy();expect(bId).toBeTruthy();

  await pageB.evaluate(()=>{const runtime=window.__KITE_BOW_GAME__.runtime;runtime.player.set(0,0,10);runtime.yaw=Math.PI;});
  await pageB.waitForTimeout(750);await pageB.evaluate(()=>window.viewer.timeline.stop());await pageA.evaluate(()=>window.viewer.timeline.start());
  await pageA.waitForFunction(()=>Math.abs(window.__KITE_BOW_GAME__.getState().remotePlayers[0].position.z-10)<1,{timeout:15_000});
  if(mode==='live')await pageA.locator('#bow-canvas').screenshot({path:resolve(root,'evidence/online-two-players.png')});
  await pageA.evaluate(()=>window.viewer.timeline.stop());
  await pageA.evaluate(()=>window.__KITE_BOW_SESSION__.ping());await pageA.waitForFunction(()=>window.__KITE_BOW_GAME__.getState().network.latencyMs!==null);
  const scoresBefore={...beforeA.network.scores};
  await pageA.evaluate(({target})=>window.__KITE_BOW_SESSION__.sendHit(target,'e2e-hit-1',60,false),{target:bId});
  await pageB.waitForFunction(()=>window.__KITE_BOW_GAME__.getState().health===40);
  await pageA.evaluate(({target})=>window.__KITE_BOW_SESSION__.sendHit(target,'e2e-hit-2',60,false),{target:bId});
  await Promise.all([pageA.waitForFunction(id=>window.__KITE_BOW_GAME__.getState().network.scores[id]===1,aId),pageB.waitForFunction(id=>window.__KITE_BOW_GAME__.getState().network.scores[id]===1,aId)]);
  const afterA=await pageA.evaluate(()=>window.__KITE_BOW_GAME__.getState()),afterB=await pageB.evaluate(()=>window.__KITE_BOW_GAME__.getState());expect(afterB.health).toBe(0);

  const capRoom=`cap-${Date.now()}`,cap=[];for(let i=0;i<10;i++){const probe=new SocketProbe(`${wsBase}/ws?room=${capRoom}&name=P${i}`);await probe.opened();await probe.waitFor('welcome');cap.push(probe);}const eleventh=new SocketProbe(`${wsBase}/ws?room=${capRoom}&name=P10`);await eleventh.opened();const full=await eleventh.waitFor('full');expect(full.type).toBe('full');for(const probe of cap)probe.close();eleventh.close();

  const roundRoom=`round-${Date.now()}`,killer=new SocketProbe(`${wsBase}/ws?room=${roundRoom}&name=Killer`),victim=new SocketProbe(`${wsBase}/ws?room=${roundRoom}&name=Victim`);await killer.opened();const killerWelcome=await killer.waitFor('welcome');await victim.opened();await victim.waitFor('welcome');const ended=killer.waitFor('round_end'),reset=killer.waitFor('round_reset',12_000),started=Date.now();for(let i=0;i<20;i++)victim.send({v:1,type:'death',killerId:killerWelcome.playerId});const roundEnd=await ended,roundReset=await reset;expect(roundEnd.scores[killerWelcome.playerId]).toBe(20);expect(roundReset.round).toBeGreaterThan(killerWelcome.round);expect(Date.now()-started).toBeGreaterThanOrEqual(4_000);killer.close();victim.close();

  const evidence={mode,baseURL,roster:afterA.network.players.map(({id,name,slot,local})=>({id,name,slot,local})),remoteCounts:[afterA.remotePlayers.length,afterB.remotePlayers.length],scoresBefore,scoresAfter:afterA.network.scores,victimHealthAfter:afterB.health,latencyMs:afterA.network.latencyMs,cap:{accepted:10,eleventhRejected:full.type==='full'},round:{winnerId:roundEnd.winnerId,scores:roundEnd.scores,resetRound:roundReset.round,resetDelayMs:Date.now()-started},consoleErrors:errors};
  await mkdir(resolve(root,'evidence'),{recursive:true});await writeFile(resolve(root,`evidence/online-${mode}.json`),JSON.stringify(evidence,null,2)+'\n');expect(errors).toEqual([]);
  await context.close();
});
