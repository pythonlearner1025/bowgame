import {EntityComponentPlugin,ThreeViewer} from 'threepipe';
import {BowGameComponent} from '../scripts/BowGameComponent.script.js';

declare global {
  interface Window {
    viewer:ThreeViewer;
    __KITE_PLAYER__?:{viewer:ThreeViewer;ecp:EntityComponentPlugin;ready:boolean};
  }
}

const canvas=document.querySelector<HTMLCanvasElement>('#bow-canvas');
if(!canvas)throw new Error('Bow player canvas is missing');

async function start(){
  const ecp=new EntityComponentPlugin(false);
  ecp.addComponentType(BowGameComponent);
  const viewer=new ThreeViewer({canvas,msaa:true,plugins:[ecp]});
  window.viewer=viewer;
  await viewer.load('/kite/assets/main.scene.glb',{autoCenter:false,autoScale:false});
  ecp.start();
  viewer.timeline.start();
  window.__KITE_PLAYER__={viewer,ecp,ready:true};
  document.documentElement.dataset.playerReady='true';
  document.querySelector('#loading')?.remove();
  viewer.setDirty();
}

void start().catch(error=>{
  const loading=document.querySelector<HTMLElement>('#loading');
  if(loading)loading.textContent='ARENA FAILED TO LOAD';
  console.error('[BowPlayer] Failed to initialize',error);
});
