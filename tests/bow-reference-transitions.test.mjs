import assert from 'node:assert/strict';
import {test,after} from 'node:test';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

// Real runtime handlers, geometry, skeleton-target transforms, and clip sampler.
// Only the unrelated browser arena authoring factory is replaced.
const bundled=await build({
  stdin:{contents:`export {BowGameRuntime} from './src/BowGameRuntime.ts'; export {sampleReferenceAction,sampleReferenceTimeline,referenceScreenPoint} from './src/BowReferenceClip.ts'; export {makeFieldBow,makeArm,firstPersonSkin} from './src/BowVisuals.ts'; export {Group,Vector3,PerspectiveCamera} from 'threepipe';`,resolveDir:new URL('..',import.meta.url).pathname,loader:'ts'},
  bundle:true,write:false,format:'esm',platform:'node',
  plugins:[{name:'browser-independent-runtime',setup(b){
    b.onResolve({filter:/^threepipe$/},()=>({path:new URL('../node_modules/threepipe/node_modules/three/build/three.module.js',import.meta.url).pathname}));
    b.onResolve({filter:/BowArena\.ts$/},()=>({path:'arena',namespace:'stub'}));
    b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export function buildBowArena(){throw new Error("Not used in transition tests");}',loader:'js'}));
  }}],
});
const temporary=await mkdtemp(join(tmpdir(),'kite3d-bow-transition-'));
after(()=>rm(temporary,{recursive:true,force:true}));
await writeFile(join(temporary,'runtime.mjs'),bundled.outputFiles[0].text);
globalThis.ImageData??=class ImageData{};
const {BowGameRuntime,sampleReferenceAction,sampleReferenceTimeline,referenceScreenPoint,makeFieldBow,makeArm,firstPersonSkin,Group,Vector3,PerspectiveCamera}=await import(pathToFileURL(join(temporary,'runtime.mjs')));

function harness(){
  const camera=new PerspectiveCamera(76,16/9,.1,200);camera.target=new Vector3();camera.controls={enabled:false};
  const canvas={},viewer={canvas,scene:{mainCamera:camera,modelRoot:{userData:{kite3dBowGame:{}}}},setDirty(){}};
  const game=new BowGameRuntime(viewer);
  game.config={version:1,kind:'bow-deathmatch',botCount:1,scoreLimit:10,difficulty:'normal',obstacles:[],playerSpawn:{x:0,y:0,z:0},botSpawns:[{x:0,y:0,z:-6}]};
  game.running=true;game.active=true;game.root=new Group();game.bow=makeFieldBow();
  const skin=firstPersonSkin();game.leftArm=makeArm(skin,-1);game.rightArm=makeArm(skin,1);game.arm=game.leftArm.root;game.hand=game.rightArm.root;
  game.root.add(game.bow,game.heldArrow,game.arm,game.hand);
  const mouse=button=>({button,target:canvas,preventDefault(){},stopImmediatePropagation(){}});
  const render=()=>{game.updateCamera();game.root.updateMatrixWorld(true);camera.updateMatrixWorld(true);};
  const advance=seconds=>{for(let remaining=seconds;remaining>1e-10;){const dt=Math.min(1/120,remaining);game.step(dt);render();remaining-=dt;}};
  render();return {game,mouse,render,advance,camera};
}

// Frame-pair discontinuities are checked in model space, not against scenery RGB.
test('the visible nocking hand and arrow remain together across the seating transition',()=>{
  const {game,render}=harness();let lastHand;
  for(const seconds of [.555,.565,.5699,.5701,.575,.585]){
    game.charge=seconds/1.15;game.drawing=true;render();
    assert.equal(game.hand.visible,true,'right hand must remain visible during nocking');
    assert.equal(game.heldArrow.visible,true,'arrow must remain visible during nocking');
    const hand=game.rightArm.hand.getWorldPosition(new Vector3());
    const nock=game.heldArrow.localToWorld(new Vector3(0,0,.28));
    assert.ok(hand.distanceTo(nock)<.045,`nocking hand target is ${(hand.distanceTo(nock)*100).toFixed(1)} cm from held arrow at ${seconds}s`);
    if(lastHand)assert.ok(hand.distanceTo(lastHand)<.05,'seating the arrow must not teleport the pulling hand');
    lastHand=hand;
  }
});

test('a real partial-charge shot starts recoil from the current grip instead of a full-draw pose',()=>{
  const {game,mouse,render,advance}=harness();game.onMouseDown(mouse(0));advance(.61*1.15);
  const before=game.bow.position.clone();assert.ok(game.charge>.60&&game.charge<.63);
  game.onMouseUp(mouse(0));render();
  assert.equal(game.arrows.length,1,'releasing a valid partial charge must still launch a gameplay arrow');
  assert.equal(game.heldArrow.visible,false,'the fired arrow must leave the held model');
  assert.ok(game.bow.position.distanceTo(before)<.01,'release at the same simulation time must preserve the pre-shot bow grip');
});

test('releasing an incomplete draw lowers smoothly and keeps the nocked arrow through cancellation',()=>{
  const {game,mouse,render,advance}=harness();game.onMouseDown(mouse(0));advance(.5*1.15);
  const before=game.bow.position.clone();assert.equal(game.heldArrow.visible,true);
  game.onMouseUp(mouse(0));render();
  assert.equal(game.arrows.length,0,'an incomplete draw cancellation must not fire');
  assert.equal(game.heldArrow.visible,true,'the nocked arrow should stay visible while lowering begins');
  assert.ok(game.bow.position.distanceTo(before)<.01,'cancellation cannot snap directly to the carry pose');
  advance(.15);assert.ok(game.bow.position.distanceTo(before)>.001,'cancellation must progress over simulation time');
});

test('right mouse aim settles over simulation time rather than teleporting the full-draw grip',()=>{
  const {game,mouse,render,advance,camera}=harness();game.onMouseDown(mouse(0));advance(1.2);
  const before=game.bow.position.clone();game.onMouseDown(mouse(2));render();
  assert.ok(game.bow.position.distanceTo(before)<.01,'RMB press at the same time cannot move the grip instantly');
  const settled=referenceScreenPoint(...sampleReferenceAction(1,-1,1).grip).add(camera.position);
  advance(.15);assert.ok(game.bow.position.distanceTo(before)>.005,'aim should visibly progress after input');
  assert.ok(game.bow.position.distanceTo(settled)>.005,'aim should not finish immediately at the first simulation step');
  advance(.6);assert.ok(game.bow.position.distanceTo(settled)<.025,'holding RMB must reach the reference aim posture');
});

test('the second reference reload does not rewind or hide its arrow at 9.45 seconds',()=>{
  let previous=sampleReferenceTimeline(9.35),arrowHasAppeared=previous.arrowVisible;
  for(let i=1;i<=35;i++){
    const seconds=9.35+i*.01,current=sampleReferenceTimeline(seconds);
    if(arrowHasAppeared)assert.equal(current.arrowVisible,true,`second reload arrow vanished again at ${seconds}s`);
    if(current.arrowVisible)arrowHasAppeared=true;
    const grip=referenceScreenPoint(...current.grip),prior=referenceScreenPoint(...previous.grip);
    assert.ok(grip.distanceTo(prior)<.04,`second reload grip jumps ${(grip.distanceTo(prior)*100).toFixed(1)}cm around9.45s`);
    previous=current;
  }
  assert.equal(sampleReferenceTimeline(9.6).arrowVisible,true,'the next arrow must have arrived during the observed nocking pose');
  assert.equal(sampleReferenceTimeline(9.6).rightVisible,true,'the right hand is visible during the observed nocking pose');
});

test('a held LMB press during recovery starts the next draw when ready, while an early mouseup clears it',()=>{
  for(const releaseEarly of [false,true]){
    const {game,mouse,advance}=harness();game.onMouseDown(mouse(0));advance(1.2);game.onMouseUp(mouse(0));
    game.onMouseDown(mouse(0));advance(.2);assert.equal(game.drawing,false,'cooldown must still prevent an early redraw');
    if(releaseEarly)game.onMouseUp(mouse(0));
    advance(.6);
    assert.equal(game.drawing,!releaseEarly,'only a still-held buffered press should begin another draw');
    assert.equal(game.arrows.length,1,'buffering the draw must not fire a second shot');
  }
});

test('extra render frames do not advance the input-driven aim transition',()=>{
  const {game,mouse,advance,render}=harness();game.onMouseDown(mouse(0));advance(1.2);game.onMouseDown(mouse(2));advance(.12);
  const before=game.bow.position.clone();
  for(let i=0;i<100;i++)render();
  assert.ok(game.bow.position.distanceTo(before)<1e-9,'aim progress is simulation-time based, independent of display refresh rate');
});
