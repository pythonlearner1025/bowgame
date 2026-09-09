import {Group, Mesh, CylinderGeometry, SphereGeometry, BoxGeometry, MeshStandardMaterial, Vector3, Quaternion, Color, FogExp2, HemisphereLight, DirectionalLight, BufferGeometry, TubeGeometry, CatmullRomCurve3, Line, LineBasicMaterial, type ThreeViewer} from 'threepipe';
import {makeFieldBow, deformBow, bowNock, makeHuman, poseHuman, makeArm, poseArm, sampleBowPose, firstPersonSkin, type HumanRig, type ArmRig} from './BowVisuals.js';
import {preloadHumanAsset, attachHumanAsset} from './BowHumanAsset.js';
import {attachFirstPersonArm} from './BowHandRig.js';
import {sampleReferenceAction,sampleReferenceTimeline,referenceScreenPoint,referenceRotation,referenceArrow,blendReferencePoses,BOW_RELEASE_SECONDS,type ReferencePose} from './BowReferenceClip.js';
import {BowArrowTrails,type ArrowTrailHandle} from './BowArrowTrail.js';
import type {BowPerformance} from './BowPerformance.js';
import {batchBowScene} from './BowSceneBatch.js';
import {BowAudio} from './BowAudio.js';
import {BOW_DRAW_SECONDS, GRAVITY, shotSpeed, shotDamage, segmentSphere, segmentCover, moveWithCover, type Cover} from './BowPhysics.js';
import {BowNetSession,type NetSnapshot} from './BowNetSession.js';
import {BOW_ROOM_CAP,type PlayerAnim,type ServerMessage} from './BowProtocol.js';

export interface BowGameConfig {version:1;kind:'bow-deathmatch';botCount:number;scoreLimit:number;difficulty:'easy'|'normal'|'hard';obstacles:Cover[];botSpawns:{x:number;y:number;z:number}[];playerSpawn:{x:number;y:number;z:number}}
interface Bot {mesh:Group;name:string;hp:number;kills:number;deaths:number;cooldown:number;respawn:number;phase:number;draw:number;leftLeg:Group;rightLeg:Group;bow:Group;human:HumanRig;release:number;heldArrow:Group;walk?:number}
interface RemotePlayer extends Bot {id:string;slot:number;seq:number;target:Vector3;targetYaw:number;targetPitch:number;targetDraw:number;anim:PlayerAnim}
interface Arrow {mesh:Group;position:Vector3;velocity:Vector3;owner:number;damage:number;age:number;stuck:boolean;trail:ArrowTrailHandle;arrowId?:string;visualOnly?:boolean;whizzed?:boolean}
const MAT=(color:number,metalness=0)=>new MeshStandardMaterial({color,roughness:0.85,metalness});
function mesh(geometry:any,material:any,parent:Group,x=0,y=0,z=0){const m=new Mesh(geometry,material);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;}
function stick(parent:Group,a:Vector3,b:Vector3,r:number,material:any){const m=mesh(new CylinderGeometry(r,r,a.distanceTo(b),8),material,parent);m.position.copy(a).add(b).multiplyScalar(.5);m.quaternion.setFromUnitVectors(new Vector3(0,1,0),b.clone().sub(a).normalize());return m;}
function arrowModel(){const g=new Group();const wood=MAT(0xaa772d),iron=MAT(0xc3c6be,.25),feather=MAT(0x6d5732);stick(g,new Vector3(0,0,.28),new Vector3(0,0,-.71),.0035,wood);const tip=mesh(new CylinderGeometry(0,.006,.06,4),iron,g,0,0,-.735);tip.rotation.x=-Math.PI/2;for(let i=0;i<3;i++){const f=mesh(new BoxGeometry(.042,.003,.15),feather,g,0,0,.2);f.rotation.z=i*Math.PI*2/3;}return g;}
const bowModel=makeFieldBow;
const animateBow=deformBow;
function disposeGroup(group:Group){const geoms=new Set<any>(),mats=new Set<any>();group.traverse((o:any)=>{if(o.geometry)geoms.add(o.geometry);if(o.material)(Array.isArray(o.material)?o.material:[o.material]).forEach((m:any)=>mats.add(m));});geoms.forEach(g=>g.dispose());mats.forEach(m=>m.dispose());group.removeFromParent();}
function disposeArena(group:Group){const textures=new Set<any>();group.traverse((o:any)=>{const materials=o.material?Array.isArray(o.material)?o.material:[o.material]:[];for(const material of materials)for(const value of Object.values(material))if((value as any)?.isTexture)textures.add(value);});disposeGroup(group);textures.forEach(texture=>texture.dispose());}

/** Declarative local API game. No supplied source code or remote assets are evaluated. */
export class BowGameRuntime {
    private lifecycle=0;
    private preview:{view:'first-person'|'character';draw:number;release:number;orbit:number;referenceTime?:number;aim?:boolean;flightSeconds?:number;flightSide?:boolean}|null=null;
    inspect(params:{view?:'first-person'|'character';draw?:number;release?:number;orbit?:number;referenceTime?:number;aim?:boolean;flightSeconds?:number;flightSide?:boolean;resume?:boolean}){
        if(!this.running)throw new Error('Start bow game play mode before inspecting it');
        if(params.resume){this.preview=null;this.restart();return this.getState();}
        const flightSeconds=params.flightSeconds,flightSide=params.flightSide;
        if(flightSeconds!==undefined&&(!Number.isFinite(flightSeconds)||flightSeconds<0||flightSeconds>1))throw new Error('flightSeconds must be within zero and one second');
        if(flightSide!==undefined&&typeof flightSide!=='boolean')throw new Error('flightSide must be boolean');
        const view=params.view??'first-person',draw=params.draw??0,release=params.release??-1,orbit=params.orbit??0,referenceTime=params.referenceTime,aim=params.aim;
        if(!['first-person','character'].includes(view)||!Number.isFinite(draw)||draw<0||draw>1||!Number.isFinite(release)||release< -1||release>2||!Number.isFinite(orbit)||Math.abs(orbit)>180)throw new Error('Invalid bow inspection view, draw, release or orbit');
        if(referenceTime!==undefined&&(!Number.isFinite(referenceTime)||referenceTime<0||referenceTime>10))throw new Error('referenceTime must be within the studied first ten seconds');
        if(aim!==undefined&&typeof aim!=='boolean')throw new Error('aim must be boolean');
        if(this.preview?.flightSeconds!==undefined||flightSeconds!==undefined)this.restart();
        this.active=false;this.keys.clear();this.drawing=false;this.preview={view,draw,release,orbit,referenceTime,aim,flightSeconds,flightSide};
        if(flightSeconds!==undefined){
            this.preview.draw=1;this.preview.aim=true;this.firePlayer(sampleReferenceAction(1,-1,1),1);
            for(let remaining=flightSeconds;remaining>1e-10;){const dt=Math.min(1/120,remaining);this.elapsed+=dt;this.stepArrows(dt);remaining-=dt;}
            this.preview.release=flightSeconds;
        }
        this.updateCamera();this.updateHud();this.viewer.setDirty();return this.getState();
    }
    private running=false; private config?:BowGameConfig; private root=new Group(); private bots:Bot[]=[]; private arrows:Arrow[]=[]; private remotePlayers=new Map<string,RemotePlayer>();
    private trails:BowArrowTrails|null=null; private sceneBatch:ReturnType<typeof batchBowScene>|null=null; private lastHudUpdate=-1;
    private player=new Vector3(); private velocity=new Vector3(); private hp=100; private kills=0; private deaths=0; private deadUntil=0; private elapsed=0; private winner='';
    private yaw=0; private pitch=0; private keys=new Set<string>(); private drawing=false; private charge=0; private recoil=0; private releaseTime=-1; private releasedCharge=0; private leftArm?:ArmRig; private rightArm?:ArmRig; private posePhase='ready'; private cooldown=0; private aiming=false; private aimBlend=0; private queuedDraw=false; private releaseFrom:ReferencePose|null=null; private cancelFrom:ReferencePose|null=null; private cancelTime=-1;
    private accumulator=0; private overlay:HTMLDivElement|null=null; private hud:Record<string,HTMLElement>={}; private hudValues:Record<string,string|boolean>=Object.create(null); private bow=new Group(); private heldArrow=new Group(); private arm=new Group(); private hand=new Group();
    private cameraRestore:any; private sceneRestore:any; private hidden:{object:any;visible:boolean}[]=[]; private flash=0; private hit=0; private message=''; private messageUntil=0; private active=false; private hadPointerLock=false; private sounds:BowAudio|null=null;
    private networkSnapshot:NetSnapshot|null=null;private networkUnsubscribe:(()=>void)|null=null;private networkAccumulator=0;private networkSeq=0;private arrowSeq=0;private receivedHits=new Set<string>();
    constructor(private viewer:ThreeViewer,config?:BowGameConfig,private arenaRoot?:Group,private isPaused:()=>boolean=()=>false,private ownsArena=false,private session:BowNetSession|null=null,private performanceStats:BowPerformance|null=null){this.config=config;}
    isConfigured(){return !!this.config;}
    async start(){
        if(this.running)this.stop();const lifecycle=++this.lifecycle;if(!this.config)return this.getState();
        await preloadHumanAsset();
        if(lifecycle!==this.lifecycle)return this.getState();
        const viewer=this.viewer,scene=viewer.scene,camera=scene.mainCamera;
        this.cameraRestore={position:camera.position.clone(),quaternion:camera.quaternion.clone(),target:camera.target?.clone(),fov:(camera as any).fov,controls:camera.controls?.enabled};
        this.sceneRestore={background:scene.background,fog:scene.fog,renderScale:viewer.renderManager.renderScale};
        viewer.renderManager.renderScale=Math.min(viewer.renderManager.renderScale,1.1);
        scene.background=new Color(0xa5b3b4);scene.fog=new FogExp2(0xa5b3b4,.012);
        for(const object of scene.modelRoot.children)if(object.name!=='K3D_BOW_DEMO_ARENA'){this.hidden.push({object,visible:object.visible});object.visible=false;}
        this.root=new Group();this.root.name='K3D_BOW_RUNTIME';scene.add(this.root);
        const arena=this.arenaRoot??scene.modelRoot.children.find(object=>object.name==='K3D_BOW_DEMO_ARENA');if(arena)this.sceneBatch=batchBowScene(arena as Group,this.root);this.trails=new BowArrowTrails();this.root.add(this.trails.root);
        const sky=new HemisphereLight(0xd9e6ee,0x5b6040,1.15);this.root.add(sky);
        const sun=new DirectionalLight(0xffdeb0,3.3);sun.position.set(-16,28,12);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-34,right:34,top:34,bottom:-34,near:.5,far:95});sun.shadow.bias=-.0005;sun.shadow.normalBias=.04;this.root.add(sun);this.root.add(sun.target);
        // Bots are intentionally absent online: remote rigs occupy the same gameplay
        // role, and mixing uncoordinated local AI into a trusted relay would diverge.
        this.bots=this.session?[]:Array.from({length:this.config.botCount},(_,i)=>this.createBot(i));
        this.bow=bowModel();this.bow.scale.setScalar(.9);this.root.add(this.bow);this.heldArrow=arrowModel();this.root.add(this.heldArrow);
        const skin=firstPersonSkin();this.leftArm=makeArm(skin,-1);this.rightArm=makeArm(skin,1);attachFirstPersonArm(this.leftArm,-1);attachFirstPersonArm(this.rightArm,1);this.arm=this.leftArm.root;this.hand=this.rightArm.root;this.root.add(this.arm,this.hand);
        this.running=true;this.restart();this.makeHud();
        if(this.session){this.networkUnsubscribe=this.session.onChange((message,snapshot)=>this.onNetwork(message,snapshot));this.session.start();}
        window.addEventListener('keydown',this.onKeyDown,true);window.addEventListener('keyup',this.onKeyUp,true);window.addEventListener('mousedown',this.onMouseDown,true);window.addEventListener('mouseup',this.onMouseUp,true);window.addEventListener('mousemove',this.onMouseMove,true);window.addEventListener('blur',this.onBlur);document.addEventListener('pointerlockchange',this.onLock);viewer.canvas.addEventListener('contextmenu',this.onContext);
        if(camera.controls)camera.controls.enabled=false;
        (camera as any).fov=76;(camera as any).updateProjectionMatrix?.();
        this.performanceStats?.attachViewer(viewer);return this.getState();
    }
    stop(){
        this.lifecycle++;
        this.networkUnsubscribe?.();this.networkUnsubscribe=null;this.session?.stop();this.networkSnapshot=null;this.remotePlayers.clear();this.receivedHits.clear();
        this.performanceStats?.detachViewer();
        window.removeEventListener('keydown',this.onKeyDown,true);window.removeEventListener('keyup',this.onKeyUp,true);window.removeEventListener('mousedown',this.onMouseDown,true);window.removeEventListener('mouseup',this.onMouseUp,true);window.removeEventListener('mousemove',this.onMouseMove,true);window.removeEventListener('blur',this.onBlur);document.removeEventListener('pointerlockchange',this.onLock);this.viewer.canvas.removeEventListener('contextmenu',this.onContext);
        if(document.pointerLockElement===this.viewer.canvas)document.exitPointerLock();
        this.keys.clear();this.preview=null;this.active=false;this.hadPointerLock=false;this.running=false;this.overlay?.remove();this.overlay=null;this.hud={};this.hudValues=Object.create(null);
        this.trails?.dispose();this.trails=null;this.sceneBatch?.dispose();this.sceneBatch=null;disposeGroup(this.root);this.arrows=[];this.bots=[];this.hidden.forEach(s=>s.object.visible=s.visible);this.hidden=[];
        const viewer=this.viewer;if(viewer&&this.cameraRestore){const c=viewer.scene.mainCamera,s=this.cameraRestore;c.position.copy(s.position);c.quaternion.copy(s.quaternion);if(s.target)c.target?.copy(s.target);if(c.controls)c.controls.enabled=s.controls;(c as any).fov=s.fov;(c as any).updateProjectionMatrix?.();this.cameraRestore=null;}
        if(viewer&&this.sceneRestore){viewer.scene.background=this.sceneRestore.background;viewer.scene.fog=this.sceneRestore.fog;viewer.renderManager.renderScale=this.sceneRestore.renderScale;this.sceneRestore=null;viewer.setDirty();}
        if(this.ownsArena&&this.arenaRoot){disposeArena(this.arenaRoot);this.arenaRoot=undefined;}
        this.sounds?.dispose();this.sounds=null;return this.getState();
    }
    getState(){return {audio:this.sounds?.getState()??null,renderBatch:this.sceneBatch?{originalMeshes:this.sceneBatch.originalMeshes,batches:this.sceneBatch.batches}:null,performance:this.performanceStats?.summary()??null,preview:this.preview,animation:{phase:this.posePhase,releaseSeconds:Number(this.releaseTime.toFixed(3))},kind:'bow-deathmatch',mode:this.session?'online':'solo',configured:this.isConfigured(),active:this.running,paused:!this.active||this.isPaused(),health:this.hp,kills:this.kills,deaths:this.deaths,scoreLimit:this.session?this.networkSnapshot?.scoreLimit??20:this.config?.scoreLimit??10,winner:this.winner,draw:Number(this.charge.toFixed(3)),arrowsInFlight:this.arrows.filter(a=>!a.stuck).length,elapsed:Number(this.elapsed.toFixed(2)),player:{id:this.networkSnapshot?.playerId??null,position:{x:this.player.x,y:this.player.y,z:this.player.z},yaw:this.yaw,pitch:this.pitch,alive:this.hp>0},bots:this.bots.map(b=>({name:b.name,health:b.hp,kills:b.kills,deaths:b.deaths,alive:b.hp>0,position:{x:b.mesh.position.x,y:b.mesh.position.y,z:b.mesh.position.z},drawing:b.draw>0})),remotePlayers:[...this.remotePlayers.values()].map(player=>({id:player.id,name:player.name,slot:player.slot,alive:player.hp>0,position:{x:player.mesh.position.x,y:player.mesh.position.y,z:player.mesh.position.z},drawing:player.draw>0})),network:this.networkSnapshot,controls:'Click viewport • WASD move • mouse aim • hold/release LMB shoot • RMB aim • Shift sprint • Space jump • R restart • M mute • Esc pause'};}
    private createBot(i:number):Bot {
        const human=makeHuman(i);attachHumanAsset(human,i);const g=human.root;g.name=['ASH','ROOK','VALE','FLINT','MOSS','BEAR'][i];
        const bow=bowModel();bow.scale.setScalar(1);bow.position.set(-.22,1.56,-.60);g.add(bow);
        const heldArrow=arrowModel();heldArrow.scale.setScalar(1);g.add(heldArrow);
        this.root.add(g);return {mesh:g,name:g.name,hp:100,kills:0,deaths:0,cooldown:2+i,respawn:0,phase:i*2.1,draw:0,leftLeg:human.legs[0].root,rightLeg:human.legs[1].root,bow,human,release:-1,heldArrow};
    }
    private slotSpawn(slot:number){
        if(slot===0)return new Vector3(this.config!.playerSpawn.x,this.config!.playerSpawn.y,this.config!.playerSpawn.z);
        const base=this.config!.botSpawns[(slot-1)%this.config!.botSpawns.length],ring=Math.floor((slot-1)/this.config!.botSpawns.length);
        return new Vector3(base.x+(ring%2?5:-5)*ring,base.y,base.z+(ring%2?-4:4)*ring);
    }
    private createRemote(id:string,name:string,slot:number){
        const human=makeHuman(slot);attachHumanAsset(human,slot);const g=human.root;g.name=`REMOTE_${id}`;
        const bow=bowModel();bow.scale.setScalar(1);bow.position.set(-.22,1.56,-.60);g.add(bow);
        const heldArrow=arrowModel();heldArrow.scale.setScalar(1);g.add(heldArrow);const spawn=this.slotSpawn(slot);g.position.copy(spawn);this.root.add(g);
        const player:RemotePlayer={id,slot,seq:-1,target:spawn.clone(),targetYaw:0,targetPitch:0,targetDraw:0,anim:'ready',mesh:g,name,hp:100,kills:0,deaths:0,cooldown:0,respawn:0,phase:slot*2.1,draw:0,leftLeg:human.legs[0].root,rightLeg:human.legs[1].root,bow,human,release:-1,heldArrow};
        this.updateBotPose(player,0);this.remotePlayers.set(id,player);return player;
    }
    private syncRemotePlayers(snapshot:NetSnapshot){
        const wanted=new Set<string>();
        for(const slot of snapshot.players){
            if(slot.local)continue;wanted.add(slot.id);const player=this.remotePlayers.get(slot.id)??this.createRemote(slot.id,slot.name,slot.slot);
            player.name=slot.name;player.slot=slot.slot;player.kills=snapshot.scores[slot.id]??0;player.deaths=slot.deaths;
            if(slot.seq>=0){player.seq=slot.seq;player.target.set(slot.pos.x,slot.pos.y,slot.pos.z);player.targetYaw=slot.yaw;player.targetPitch=slot.pitch;player.targetDraw=slot.draw;player.anim=slot.anim;}
            if(slot.anim==='dead'){player.hp=0;player.mesh.visible=false;}else if(player.hp<=0){player.hp=100;player.mesh.visible=true;}
        }
        for(const [id,player]of this.remotePlayers)if(!wanted.has(id)){disposeGroup(player.mesh);this.remotePlayers.delete(id);}
    }
    private onNetwork(message:ServerMessage|null,snapshot:NetSnapshot){
        const previousId=this.networkSnapshot?.playerId;this.networkSnapshot=snapshot;this.syncRemotePlayers(snapshot);
        if(snapshot.playerId)this.kills=snapshot.scores[snapshot.playerId]??0;
        const local=snapshot.players.find(player=>player.local);if(local)this.deaths=local.deaths;
        if(message?.type==='welcome'&&snapshot.playerId!==previousId){const own=snapshot.players.find(player=>player.local);if(own){this.player.copy(this.slotSpawn(own.slot));this.velocity.set(0,0,0);this.hp=100;}}
        if(message?.type==='shot'&&message.playerId!==snapshot.playerId)this.spawnArrow(new Vector3(message.origin.x,message.origin.y,message.origin.z),new Vector3(message.velocity.x,message.velocity.y,message.velocity.z),0,message.arrowId,true);
        if(message?.type==='hit'&&message.targetId===snapshot.playerId)this.applyNetworkHit(message);
        if(message?.type==='death'){const player=this.remotePlayers.get(message.playerId);if(player){player.hp=0;player.mesh.visible=false;}}
        if(message?.type==='round_end'){const winner=snapshot.players.find(player=>player.id===message.winnerId);this.winner=message.winnerId===snapshot.playerId?'YOU':winner?.name??'ARCHER';this.message=`${this.winner} reached ${snapshot.scoreLimit} eliminations`;this.messageUntil=Infinity;}
        if(message?.type==='round_reset')this.resetOnlineRound();
        if(message?.type==='full'){this.message='Server full';this.messageUntil=Infinity;}
        this.updateHud();
    }
    private applyNetworkHit(message:Extract<ServerMessage,{type:'hit'}>){
        const key=`${message.playerId}:${message.arrowId}`;if(this.hp<=0||this.receivedHits.has(key))return;this.receivedHits.add(key);
        this.hp=Math.max(0,this.hp-message.damage);this.flash=1;this.sounds?.impact(this.player.clone().add(new Vector3(0,message.head?1.65:1.05,0)),message.head?'head':'body');
        if(this.hp>0){this.message=`${message.head?'HEADSHOT':'HIT'}  −${message.damage}`;this.messageUntil=this.elapsed+1.7;return;}
        this.deaths++;this.deadUntil=this.elapsed+3;this.drawing=false;this.charge=0;this.session?.sendDeath(message.playerId);this.message='YOU WERE ELIMINATED';this.messageUntil=this.elapsed+3;
    }
    private resetOnlineRound(){
        this.hp=100;this.deadUntil=0;this.winner='';this.receivedHits.clear();const local=this.networkSnapshot?.players.find(player=>player.local);this.player.copy(this.slotSpawn(local?.slot??0));this.velocity.set(0,0,0);this.drawing=false;this.charge=0;this.cooldown=0;this.releaseTime=-1;this.message='NEW ROUND';this.messageUntil=this.elapsed+2;
        this.arrows.forEach(arrow=>disposeGroup(arrow.mesh));this.arrows=[];this.trails?.clear();for(const player of this.remotePlayers.values()){player.hp=100;player.mesh.visible=true;player.target.copy(this.slotSpawn(player.slot));}
    }
    private updateBotPose(b:Bot,draw:number,walk=0,relaxed=false,release=-1){
        const pose=sampleBowPose(draw,release,1,this.elapsed);poseHuman(b.human,pose.draw,walk,relaxed);
        b.bow.visible=b.heldArrow.visible=!relaxed;b.bow.position.set(-.22,1.56,-.60);b.bow.rotation.set(-.10,.58,0);
        if(release>=.15&&release<1.05){const t=(release-.15)/.9,reach=Math.sin(t*Math.PI);b.bow.position.y-=reach*.13;b.bow.rotation.z=-reach*.22;poseArm(b.human.right,new Vector3(.245,1.44,0),new Vector3(.45,1.5+reach*.15,.05),new Vector3(.13,1.4+reach*.48,-.1+reach*.24));}
        animateBow(b.bow,pose.draw,pose.vibration);b.heldArrow.visible=!relaxed&&pose.arrowVisible;
        const nock=bowNock(pose.draw).applyQuaternion(b.bow.quaternion).add(b.bow.position);
        if(!relaxed){poseArm(b.human.left,new Vector3(-.245,1.44,0),new Vector3(-.29,1.46,-.31),b.bow.position,b.bow.quaternion);if(release<.15||release>=1.05)poseArm(b.human.right,new Vector3(.245,1.44,0),new Vector3(.40+pose.draw*.12,1.38+pose.draw*.08,-.12+pose.draw*.2),nock,b.bow.quaternion);}
        b.heldArrow.position.copy(nock).add(new Vector3(0,0,-.28).applyQuaternion(b.bow.quaternion));b.heldArrow.quaternion.copy(b.bow.quaternion);b.human.applyPose?.(relaxed);
    }
    private restart(){this.preview=null;if(!this.config)return;const local=this.networkSnapshot?.players.find(player=>player.local);this.player.copy(this.session?this.slotSpawn(local?.slot??0):this.config.playerSpawn);this.hp=100;this.kills=0;this.deaths=0;this.deadUntil=0;this.winner='';this.elapsed=0;this.yaw=0;this.pitch=0;this.velocity.set(0,0,0);this.drawing=false;this.charge=0;this.cooldown=0;this.releaseTime=-1;this.releasedCharge=0;this.releaseFrom=null;this.cancelFrom=null;this.cancelTime=-1;this.aimBlend=0;this.aiming=false;this.queuedDraw=false;this.flash=0;this.hit=0;this.message='';this.messageUntil=0;this.accumulator=0;this.networkAccumulator=0;this.networkSeq=0;this.receivedHits.clear();this.arrows.forEach(a=>disposeGroup(a.mesh));this.arrows=[];this.trails?.clear();this.bots.forEach((b,i)=>{b.kills=0;b.deaths=0;this.spawnBot(b,i);});this.updateCamera();}
    private spawnBot(b:Bot,i:number){const p=this.config!.botSpawns[i%this.config!.botSpawns.length];b.mesh.position.set(p.x+(i>=3?3:0),0,p.z);if(b.mesh.position.distanceTo(this.player)<8)b.mesh.position.multiplyScalar(-1);b.hp=100;b.mesh.visible=true;b.cooldown=2+i*.35;b.draw=0;b.release=-1;b.respawn=0;this.updateBotPose(b,0);}
    private typing(target:EventTarget|null){const e=target as HTMLElement;return e&&(e.isContentEditable||['INPUT','TEXTAREA','SELECT'].includes(e.tagName));}
    private onKeyDown=(e:KeyboardEvent)=>{if(!this.running||this.typing(e.target)||!['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','ShiftLeft','ShiftRight','Space','KeyR','KeyM'].includes(e.code))return;e.preventDefault();e.stopImmediatePropagation();if(e.code==='KeyR'&&!e.repeat){if(!this.session)this.restart();}else if(e.code==='KeyM'&&!e.repeat){if(this.sounds)this.sounds.setMuted(!this.sounds.isMuted());}else this.keys.add(e.code);};
    private onKeyUp=(e:KeyboardEvent)=>{if(this.keys.delete(e.code)){e.preventDefault();e.stopImmediatePropagation();}};
    private onContext=(e:Event)=>e.preventDefault();
    private onMouseDown=(e:MouseEvent)=>{if(!this.running||e.target!==this.viewer.canvas)return;e.preventDefault();e.stopImmediatePropagation();if(!this.active){this.enter();return;}if(e.button===0&&this.hp>0&&!this.winner){if(this.cooldown<=0&&this.cancelTime<0)this.drawing=true;else this.queuedDraw=true;}if(e.button===2)this.aiming=true;};
    private enter=()=>{if(this.preview)this.restart();if(this.session){const input=this.hud.name as HTMLInputElement|undefined;if(input)this.session.setName(input.value);if(this.networkSnapshot?.status!=='connected')return;}const canvas=this.viewer.canvas;try{const pending=canvas.requestPointerLock();(pending as any)?.catch?.(()=>{this.message='Pointer lock unavailable — drag on canvas to aim';this.messageUntil=this.elapsed+8;});}catch{}this.active=true;this.sounds??=new BowAudio();this.sounds.resume().catch(()=>{});};
    private onMouseUp=(e:MouseEvent)=>{
        if(!this.running)return;
        if(e.button===0){
            this.queuedDraw=false;
            if(this.drawing){
                const from=this.sampleLivePose();
                if(this.charge>.60&&this.hp>0&&!this.winner){
                    this.firePlayer(from,this.charge);
                    this.recoil=1;this.releaseTime=0;this.releasedCharge=this.charge;this.releaseFrom=from;this.cancelFrom=null;this.cancelTime=-1;this.cooldown=BOW_RELEASE_SECONDS;
                }else if(this.charge>0){this.cancelFrom=from;this.cancelTime=0;}
                this.drawing=false;this.charge=0;
            }
        }
        if(e.button===2)this.aiming=false;
    };
    private onMouseMove=(e:MouseEvent)=>{if(!this.running||!this.active)return;if(document.pointerLockElement!==this.viewer.canvas&&!(e.buttons&1))return;this.yaw-=e.movementX*(this.aiming?.0011:.0018);this.pitch=Math.max(-1.25,Math.min(1.25,this.pitch-e.movementY*(this.aiming?.0011:.0018)));e.stopImmediatePropagation();};
    private onBlur=()=>{this.keys.clear();if(this.drawing&&this.charge>0){this.cancelFrom=this.sampleLivePose();this.cancelTime=0;}this.drawing=false;this.charge=0;this.queuedDraw=false;this.aiming=false;this.active=false;this.sounds?.suspend();};
    private onLock=()=>{if(document.pointerLockElement===this.viewer.canvas){this.hadPointerLock=true;this.active=true;}else if(this.hadPointerLock){this.hadPointerLock=false;this.onBlur();}};

    private firePlayer(pose:ReferencePose,charge:number){
        // The rendered arrowhead is the sight: launch from that same point along its camera ray.
        this.updateCamera();const camera=this.viewer.scene.mainCamera,tip=referenceArrow(pose).tip;
        const origin=tip.clone().applyQuaternion(camera.quaternion).add(camera.position);
        const direction=tip.clone().normalize().applyQuaternion(camera.quaternion);
        this.fire(origin,direction,-1,charge);
    }
    private fire(position:Vector3,direction:Vector3,owner:number,charge:number){
        const velocity=direction.multiplyScalar(shotSpeed(charge)),arrowId=this.session&&owner<0?`${this.networkSnapshot?.playerId??'pending'}-${++this.arrowSeq}`:undefined;
        this.spawnArrow(position,velocity,owner,arrowId,false,shotDamage(charge));if(arrowId)this.session?.sendShot(arrowId,{x:position.x,y:position.y,z:position.z},{x:velocity.x,y:velocity.y,z:velocity.z});
    }
    private spawnArrow(position:Vector3,velocity:Vector3,owner:number,arrowId?:string,visualOnly=false,damage=shotDamage(1)){this.sounds?.release(owner<0?undefined:position,owner);const model=arrowModel();model.position.copy(position);this.root.add(model);if(!this.trails){this.trails=new BowArrowTrails();this.root.add(this.trails.root);}const trail=this.trails.spawn(position,this.elapsed);this.arrows.push({mesh:model,position,velocity,owner,damage,age:0,stuck:false,trail,arrowId,visualOnly});if(this.arrows.length>90){const old=this.arrows.shift()!;this.trails.remove(old.trail);disposeGroup(old.mesh);}}
    update(deltaTime:number,time=performance.now()){
        if(!this.running)return false;
        const start=performance.now(),frameMs=Math.max(0,deltaTime),dt=Math.min(frameMs/1000,.08);
        const active=this.active&&!this.isPaused()&&!this.winner;
        if(active){this.accumulator+=dt;while(this.accumulator>=1/120){this.step(1/120);this.accumulator-=1/120;}}
        for(const bot of this.bots)if(bot.hp>0)this.updateBotPose(bot,bot.draw,bot.walk??0,false,bot.release);
        for(const player of this.remotePlayers.values())if(player.hp>0){this.updateBotPose(player,player.draw,player.walk??0,false,player.release);player.bow.rotation.x+=player.targetPitch*.25;}
        this.updateCamera();if(time-this.lastHudUpdate>33){this.updateHud();this.lastHudUpdate=time;this.sounds?.draw(-1,active&&this.hp>0&&this.drawing?this.charge:0);for(let i=0;i<this.bots.length;i++)this.sounds?.draw(i,active&&this.bots[i].hp>0?this.bots[i].draw:0,this.bots[i].mesh.position);}
        this.performanceStats?.record(time,frameMs,performance.now()-start,active);
        return true;
    }
    private step(dt:number){
        this.elapsed+=dt;
        this.aimBlend+=Math.max(-dt/.4,Math.min(dt/.4,Number(this.aiming)-this.aimBlend));
        if(this.releaseTime>=0){this.releaseTime+=dt;if(this.releaseTime>=BOW_RELEASE_SECONDS){this.releaseTime=-1;this.releaseFrom=null;}}
        if(this.cancelTime>=0){this.cancelTime+=dt;if(this.cancelTime>=.3){this.cancelTime=-1;this.cancelFrom=null;}}
        this.cooldown=Math.max(0,this.cooldown-dt);
        if(this.queuedDraw&&this.cooldown<=0&&this.cancelTime<0&&this.hp>0&&!this.winner){this.drawing=true;this.charge=0;this.queuedDraw=false;}
        this.recoil=Math.max(0,this.recoil-dt*5);this.flash=Math.max(0,this.flash-dt*1.8);this.hit=Math.max(0,this.hit-dt*2.8);
        if(this.hp<=0){if(this.elapsed>=this.deadUntil){this.hp=100;const local=this.networkSnapshot?.players.find(player=>player.local);this.player.copy(this.session?this.slotSpawn(local?.slot??0):this.config!.playerSpawn);this.velocity.set(0,0,0);}}else{
            const x=Number(this.keys.has('KeyD')||this.keys.has('ArrowRight'))-Number(this.keys.has('KeyA')||this.keys.has('ArrowLeft')),z=Number(this.keys.has('KeyS')||this.keys.has('ArrowDown'))-Number(this.keys.has('KeyW')||this.keys.has('ArrowUp'));
            const length=Math.hypot(x,z)||1,sprint=(this.keys.has('ShiftLeft')||this.keys.has('ShiftRight'))&&!this.drawing;const speed=this.drawing?2.6:sprint?7:4.5;
            const dx=(x*Math.cos(this.yaw)+z*Math.sin(this.yaw))/length*speed*dt,dz=(-x*Math.sin(this.yaw)+z*Math.cos(this.yaw))/length*speed*dt;
            this.player.copy(moveWithCover(this.player,dx,dz,this.config!.obstacles));
            if(this.keys.has('Space')&&this.player.y===0)this.velocity.y=4.8;this.velocity.y-=GRAVITY*dt;this.player.y=Math.max(0,this.player.y+this.velocity.y*dt);if(this.player.y===0)this.velocity.y=0;
            if(this.drawing)this.charge=Math.min(1,this.charge+dt/BOW_DRAW_SECONDS);
        }
        this.bots.forEach((b,i)=>this.stepBot(b,i,dt));this.stepRemotePlayers(dt);this.stepArrows(dt);this.sendNetworkState(dt);
    }
    private stepRemotePlayers(dt:number){for(const player of this.remotePlayers.values()){
        const before=player.mesh.position.clone();const blend=1-Math.exp(-dt*12);player.mesh.position.lerp(player.target,blend);player.mesh.rotation.y+=(player.targetYaw-player.mesh.rotation.y)*blend;player.draw+=(player.targetDraw-player.draw)*blend;
        player.walk=player.anim==='walk'?Math.sin(this.elapsed*7+player.phase):before.distanceTo(player.mesh.position)>dt*.2?Math.sin(this.elapsed*7+player.phase):0;
        if(player.anim==='release'){if(player.release<0)player.release=0;else player.release=Math.min(1.05,player.release+dt);}else player.release=-1;
    }}
    private sendNetworkState(dt:number){if(!this.session)return;this.networkAccumulator+=dt;if(this.networkAccumulator<.05)return;this.networkAccumulator%=.05;
        const moving=this.keys.has('KeyW')||this.keys.has('KeyA')||this.keys.has('KeyS')||this.keys.has('KeyD')||this.keys.has('ArrowUp')||this.keys.has('ArrowDown')||this.keys.has('ArrowLeft')||this.keys.has('ArrowRight');
        const anim:PlayerAnim=this.hp<=0?'dead':this.releaseTime>=0?'release':this.drawing?'draw':moving?'walk':'ready';this.session.sendState(++this.networkSeq,{x:this.player.x,y:this.player.y,z:this.player.z},this.yaw,this.pitch,this.charge,anim);
    }
    private stepBot(b:Bot,index:number,dt:number){
        if(b.hp<=0){if(this.elapsed>b.respawn)this.spawnBot(b,index);return;}
        const target=this.player.clone().add(new Vector3(0,1.28,0)),origin=b.mesh.position.clone().add(new Vector3(0,1.34,0));const delta=target.clone().sub(origin),distance=delta.length();
        b.mesh.rotation.y=Math.atan2(-delta.x,-delta.z);b.cooldown-=dt;if(b.release>=0){b.release+=dt;if(b.release>=1.05)b.release=-1;}
        const blocked=this.config!.obstacles.some(c=>segmentCover(origin,target,c)!==null);const advance=distance>17?1:distance<9?-.8:.05;const strafe=Math.sin(this.elapsed*.7+b.phase)>.0?1:-1;
        const toward=delta.clone().setY(0).normalize(),side=new Vector3(-toward.z,0,toward.x);const movement=toward.multiplyScalar(blocked?1:advance).addScaledVector(side,blocked?1:.7).normalize().multiplyScalar((b.draw?1.2:2.1)*dt);
        const old=b.mesh.position.clone();b.mesh.position.copy(moveWithCover(old,movement.x,movement.z,this.config!.obstacles,.42));const walking=old.distanceTo(b.mesh.position)>dt*.2;b.leftLeg.rotation.x=walking?Math.sin(this.elapsed*7+b.phase)*.5:0;b.rightLeg.rotation.x=-b.leftLeg.rotation.x;
        if(this.hp>0&&!blocked&&distance<38&&b.cooldown<=0){b.draw+=dt/1.1;if(b.draw>=1){const level=this.config!.difficulty,spread=level==='easy'?.10:level==='hard'?.017:.045;const speed=shotSpeed(.85);target.y+=GRAVITY*.5*Math.pow(distance/speed,2);target.x+=(Math.random()-.5)*distance*spread;target.y+=(Math.random()-.5)*distance*spread;this.fire(origin,target.sub(origin).normalize(),index,.85);b.draw=0;b.release=0;b.cooldown=(level==='easy'?3.4:level==='hard'?1.7:2.6)+Math.random();}}else b.draw=Math.max(0,b.draw-dt*2);
        b.walk=walking?Math.sin(this.elapsed*7+b.phase):0;
    }
    private stepArrows(dt:number){for(const arrow of [...this.arrows]){
        arrow.age+=dt;if(arrow.age>12){this.trails?.remove(arrow.trail);disposeGroup(arrow.mesh);this.arrows.splice(this.arrows.indexOf(arrow),1);continue;}if(arrow.stuck)continue;
        const from=arrow.position.clone();arrow.velocity.y-=GRAVITY*dt;const to=from.clone().addScaledVector(arrow.velocity,dt);let nearest=1,victim:number|string|null=null,head=false,collided=false;
        if(to.y<=.025){nearest=Math.max(0,(from.y-.025)/(from.y-to.y));collided=true;}
        for(const c of this.config!.obstacles){const t=segmentCover(from,to,c);if(t!==null&&t<=nearest){nearest=t;victim=null;collided=true;}}
        const candidates:{position:Vector3;hp:number;index:number|string}[]=arrow.visualOnly?[]:this.session&&arrow.owner<0?[...this.remotePlayers.values()].map(player=>({position:player.mesh.position,hp:player.hp,index:player.id})):arrow.owner<0?this.bots.map((b,i)=>({position:b.mesh.position,hp:b.hp,index:i})):[{position:this.player,hp:this.hp,index:-1}];
        for(const c of candidates){if(c.hp<=0)continue;for(const [height,r,isHead]of [[1.65,.24,true],[1.05,.4,false],[.5,.29,false]] as const){const t=segmentSphere(from,to,c.position.clone().add(new Vector3(0,height,0)),r);if(t!==null&&t<nearest){nearest=t;victim=c.index;head=isHead;collided=true;}}}
        arrow.position.copy(from).lerp(to,nearest);this.trails?.sample(arrow.trail,arrow.position,this.elapsed);arrow.mesh.position.copy(arrow.position).addScaledVector(arrow.velocity.clone().normalize(),-.765);arrow.mesh.quaternion.setFromUnitVectors(new Vector3(0,0,-1),arrow.velocity.clone().normalize());
        if(!collided&&arrow.owner>=0&&!arrow.whizzed&&this.sounds?.whizz(from,to))arrow.whizzed=true;
        if(collided){this.sounds?.impact(arrow.position,head?'head':victim!==null?'body':'cover');this.trails?.stop(arrow.trail);arrow.stuck=true;arrow.age=8;if(victim!==null){const damage=Math.round(arrow.damage*(head?1.8:1));if(typeof victim==='string'){if(head)this.sounds?.headshotConfirm();this.hit=1;const remote=this.remotePlayers.get(victim);this.message=`${head?'HEADSHOT':'HIT'}  −${damage}  ${remote?.name??'ARCHER'}`;this.messageUntil=this.elapsed+1.7;if(arrow.arrowId)this.session?.sendHit(victim,arrow.arrowId,damage,head);}else this.damage(victim,damage,arrow.owner,head);arrow.mesh.visible=false;}}
        if(arrow.position.length()>110){this.trails?.remove(arrow.trail);disposeGroup(arrow.mesh);this.arrows.splice(this.arrows.indexOf(arrow),1);}
    }}
    private damage(victim:number,damage:number,owner:number,head:boolean){
        if(head&&owner<0&&victim>=0)this.sounds?.headshotConfirm();
        if(victim===-1){this.hp=Math.max(0,this.hp-damage);this.flash=1;if(!this.hp){this.deaths++;this.deadUntil=this.elapsed+3;this.drawing=false;this.charge=0;this.bots[owner].kills++;this.message=`${this.bots[owner].name} eliminated you`;this.messageUntil=this.elapsed+3;}}
        else{const b=this.bots[victim];b.hp=Math.max(0,b.hp-damage);this.hit=1;this.message=`${head?'HEADSHOT':'HIT'}  −${damage}  ${b.name}`;this.messageUntil=this.elapsed+1.7;if(!b.hp){b.deaths++;b.respawn=this.elapsed+3.5;b.mesh.visible=false;this.kills++;this.message=`${b.name} eliminated  +1`;}}
        if(this.kills>=this.config!.scoreLimit)this.winner='YOU';const winningBot=this.bots.find(b=>b.kills>=this.config!.scoreLimit);if(winningBot)this.winner=winningBot.name;
    }
    /** Input-driven transitions share the reference poses and advance only with simulation time. */
    private sampleLivePose():ReferencePose {
        if(this.releaseTime>=0){
            const target=sampleReferenceAction(0,this.releaseTime,this.aimBlend);
            if(!this.releaseFrom)return target;
            const u=Math.min(1,this.releaseTime/.14),t=u*u*(3-2*u);
            return {...blendReferencePoses(this.releaseFrom,target,t),arrowVisible:false,rightVisible:false,phase:target.phase};
        }
        if(this.cancelTime>=0&&this.cancelFrom){
            const from=this.cancelFrom,target=sampleReferenceAction(0),u=Math.min(1,this.cancelTime/.3),t=u*u*(3-2*u);
            // Keep the same arrow in the hand while it is lowered completely below the viewport.
            target.arrowTip=[from.arrowTip[0],1.35];target.arrowNear=[from.arrowNear[0],1.95];
            const pose=blendReferencePoses(from,target,t);
            return {...pose,arrowVisible:from.arrowVisible&&u<1,rightVisible:from.rightVisible&&u<1,arrowSeated:from.arrowSeated,phase:'cancel'};
        }
        return sampleReferenceAction(this.charge,-1,this.aimBlend);
    }
    private updateCamera(){if(!this.running)return;this.trails?.update(this.elapsed,this.viewer.scene.mainCamera.position);if(this.preview?.view==='character'){const c=this.viewer.scene.mainCamera,b=this.bots[0];this.bow.visible=this.arm.visible=this.hand.visible=this.heldArrow.visible=false;this.bots.forEach((v,i)=>v.mesh.visible=i===0);const angle=this.preview.orbit*Math.PI/180;b.mesh.position.set(0,0,17);b.mesh.rotation.set(0,0,0);b.leftLeg.rotation.set(0,0,0);b.rightLeg.rotation.set(0,0,0);this.updateBotPose(b,this.preview.draw,0,this.preview.draw===0&&this.preview.release<0,this.preview.release);c.position.set(Math.sin(angle)*3.15,.98,17-Math.cos(angle)*3.15);c.lookAt(0,.98,17);c.target?.set(0,.98,17);(c as any).fov=this.preview.draw>0||this.preview.release>=0?48:40;(c as any).updateProjectionMatrix?.();c.setDirty?.({change:'transform'});return;}if(this.preview)this.charge=this.preview.draw;const camera=this.viewer.scene.mainCamera;if(camera.controls)camera.controls.enabled=false;const walk=this.keys.size>0&&this.hp>0&&this.active;camera.position.copy(this.player).add(new Vector3(0,this.hp>0?1.66: .55,0));if(walk)camera.position.y+=Math.sin(this.elapsed*10)*.025;camera.rotation.set(this.pitch,this.yaw,0,'YXZ');const dir=new Vector3(0,0,-1).applyQuaternion(camera.quaternion);camera.target?.copy(camera.position).add(dir);const wanted=76;(camera as any).fov=wanted;(camera as any).updateProjectionMatrix?.();camera.setDirty?.({change:'transform'});
        this.sounds?.setListener(camera.position,new Vector3(1,0,0).applyQuaternion(camera.quaternion));
        const q=camera.quaternion,release=this.preview?.release??this.releaseTime;
        const pose=this.preview?.referenceTime!==undefined?sampleReferenceTimeline(this.preview.referenceTime):this.preview?sampleReferenceAction(this.preview.draw,release,(this.preview.aim??this.aiming)?1:0):this.sampleLivePose();this.posePhase=pose.phase;
        const localRotation=referenceRotation(pose),grip=referenceScreenPoint(...pose.grip),scale=.9;
        this.bow.position.copy(grip).applyQuaternion(q).add(camera.position);this.bow.quaternion.copy(q).multiply(localRotation);this.bow.scale.setScalar(scale);animateBow(this.bow,pose.tension,release>=0?Math.sin(release*115)*Math.exp(-release*24)*.025:0);
        this.arm.position.copy(camera.position);this.hand.position.copy(camera.position);this.arm.quaternion.copy(q);this.hand.quaternion.copy(q);
        const arrow=referenceArrow(pose),nock=arrow.nock;
        if(pose.arrowVisible&&pose.arrowSeated){const localNock=nock.clone().sub(grip).applyQuaternion(localRotation.clone().invert()).divideScalar(scale),string=this.bow.userData.bowString as Line,points=string.geometry.getAttribute('position');points.setXYZ(1,localNock.x,localNock.y,localNock.z);points.needsUpdate=true;string.geometry.computeBoundingSphere();}
        const pull=pose.arrowVisible?nock:referenceScreenPoint(...pose.right);
        this.leftArm?.setFingerRelease?.(pose.leftOpen);this.rightArm?.setFingerRelease?.(pose.rightOpen);
        if(this.leftArm)poseArm(this.leftArm,new Vector3(-.68,-.55,.12),new Vector3(-.54,-.42,-.35),grip,localRotation);
        if(this.rightArm&&pose.rightVisible)poseArm(this.rightArm,new Vector3(.5,-.6,.08),new Vector3(.48,-.45,-.06),pull,new Quaternion().setFromAxisAngle(new Vector3(0,0,1),-.15));
        // The full-draw nock and pulling hand retreat below the camera exactly as in the supplied clip.
        this.hand.visible=this.hp>0&&pose.rightVisible;this.arm.visible=this.bow.visible=this.hp>0;
        const arrowAnchor=nock;
        const arrowRotation=arrow.rotation;
        this.heldArrow.position.copy(arrowAnchor).add(new Vector3(0,0,-.28*scale).applyQuaternion(arrowRotation)).applyQuaternion(q).add(camera.position);this.heldArrow.quaternion.copy(q).multiply(arrowRotation);this.heldArrow.scale.setScalar(scale);
        this.heldArrow.visible=this.hp>0&&pose.arrowVisible;
        if(this.preview?.flightSeconds!==undefined){
            this.heldArrow.visible=false;
            if(this.preview.flightSide&&this.arrows[0]){const point=this.arrows[0].position;this.bow.visible=this.arm.visible=this.hand.visible=false;camera.position.copy(point).add(new Vector3(8,2,5));camera.lookAt(point.x,point.y,point.z+3);camera.target?.set(point.x,point.y,point.z+3);camera.setDirty?.({change:'transform'});}
        }
        this.trails?.update(this.elapsed,camera.position);


    }

    private setHudText(id:string,value:string){const key=`text:${id}`;if(this.hudValues[key]===value)return;this.hudValues[key]=value;this.hud[id].textContent=value;}
    private setHudStyle(id:string,property:string,value:string){const key=`style:${id}:${property}`;if(this.hudValues[key]===value)return;this.hudValues[key]=value;this.hud[id].style.setProperty(property,value);}
    private setHudDisabled(id:string,value:boolean){const key=`disabled:${id}`;if(this.hudValues[key]===value)return;this.hudValues[key]=value;(this.hud[id] as HTMLButtonElement).disabled=value;}
    private makeHud(){
        this.hudValues=Object.create(null);
        const overlay=document.createElement('div');overlay.id='kite3d-bow-game-hud';overlay.style.cssText='position:fixed;z-index:10000;pointer-events:none;color:#ecece3;font:13px system-ui,sans-serif;overflow:hidden;';this.hud.overlay=overlay;
        const add=(id:string,style:string,text='')=>{const e=document.createElement('div');e.style.cssText=style;e.textContent=text;overlay.append(e);this.hud[id]=e;this.hudValues[`text:${id}`]=text;return e;};
        add('brand','position:absolute;left:28px;top:24px;font-size:13px;letter-spacing:5px;font-weight:800;','TIMBER / ASH');add('sub','position:absolute;left:29px;top:46px;font-size:10px;letter-spacing:2px;color:#c8c9b7;','BOW DEATHMATCH · LOCAL BOT ARENA');
        add('score','position:absolute;top:24px;right:28px;text-align:right;font-size:15px;font-weight:700;');add('board','position:absolute;right:28px;top:56px;line-height:23px;color:#d0d0c4;white-space:pre;text-align:right;font-size:11px;');
        if(this.session)add('network','position:absolute;left:29px;top:65px;font-size:10px;letter-spacing:1.2px;color:#d6cfa8;','ONLINE · CONNECTING');
        add('hit','position:absolute;left:50%;top:50%;font-size:32px;transform:translate(-50%,-50%);color:#ffdca1;','×');
        add('health','position:absolute;left:28px;bottom:55px;font-size:31px;font-weight:700;');add('healthbar','position:absolute;left:28px;bottom:45px;height:3px;background:#b8c89a;width:160px;');add('ammo','position:absolute;right:28px;bottom:50px;text-align:right;font-size:12px;letter-spacing:2px;','FIELD BOW\n∞ ARROWS');this.hud.ammo.style.whiteSpace='pre';
        add('feed','position:absolute;left:0;right:0;top:59%;text-align:center;color:#ffdaa0;font-weight:700;letter-spacing:1px;');
        add('help','position:absolute;bottom:17px;left:28px;right:28px;font-size:10px;color:#d8dacb;letter-spacing:.7px;','WASD MOVE     SHIFT SPRINT     SPACE JUMP     HOLD LMB DRAW / RELEASE FIRE     RMB AIM     R RESTART     M MUTE     ESC PAUSE');
        add('damage','position:absolute;inset:0;box-shadow:inset 0 0 100px 30px #a02b22;opacity:0;');
        const modal=add('modal','position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(440px,85%);background:rgba(22,27,23,.92);border:1px solid #727564;padding:32px;text-align:center;pointer-events:auto;box-shadow:0 20px 70px #0008;');
        const title=document.createElement('div');title.style.cssText='font-size:27px;font-weight:800;letter-spacing:5px;margin-bottom:12px';title.textContent='TIMBER / ASH';modal.append(title);this.hud.title=title;this.hudValues['text:title']='TIMBER / ASH';
        const description=document.createElement('div');description.style.cssText='color:#bfc6b4;line-height:1.8;font-size:13px;white-space:pre-line;margin-bottom:24px';modal.append(description);this.hud.description=description;
        if(this.session){const input=document.createElement('input');input.setAttribute('aria-label','Archer name');input.maxLength=24;input.value=this.session.getName();input.style.cssText='display:block;width:100%;margin:-6px 0 18px;padding:11px 12px;background:#111713;color:#ecece3;border:1px solid #727564;text-align:center;font:700 13px system-ui,sans-serif;letter-spacing:1px;outline:none';modal.append(input);this.hud.name=input;}
        const button=document.createElement('button');button.textContent='ENTER ARENA';button.style.cssText='background:#bdc593;border:0;padding:13px 26px;color:#22291b;font-weight:800;letter-spacing:2px;cursor:pointer';button.onclick=()=>{if(this.winner&&!this.session)this.restart();this.enter();};modal.append(button);this.hud.button=button;this.hudValues['text:button']='ENTER ARENA';
        if(this.session){const solo=document.createElement('button');solo.textContent='PLAY SOLO';solo.style.cssText='display:none;margin:14px auto 0;background:transparent;border:1px solid #9da283;padding:10px 20px;color:#d8dacb;font-weight:700;letter-spacing:2px;cursor:pointer';solo.onclick=()=>{const url=new URL(location.href);url.searchParams.delete('online');url.searchParams.set('solo','1');location.href=url.href;};modal.append(solo);this.hud.solo=solo;}
        (this.viewer.container??document.body).append(overlay);this.overlay=overlay;this.updateHud();
    }
    private updateHud(){if(!this.overlay)return;const rect=this.viewer.canvas.getBoundingClientRect();this.setHudStyle('overlay','left',`${rect.left}px`);this.setHudStyle('overlay','top',`${rect.top}px`);this.setHudStyle('overlay','width',`${rect.width}px`);this.setHudStyle('overlay','height',`${rect.height}px`);
        const snapshot=this.networkSnapshot,online=!!this.session,limit=online?snapshot?.scoreLimit??20:this.config!.scoreLimit;
        this.setHudText('score',`${String(this.kills).padStart(2,'0')} / ${limit}  ELIMINATIONS`);
        if(online){const players=snapshot?.players??[];this.setHudText('board',[...players].sort((a,b)=>a.slot-b.slot).map(player=>`${player.local?'YOU':player.name}    ${snapshot?.scores[player.id]??0} K / ${player.deaths} D`).join('\n'));const latency=snapshot?.latencyMs===null||snapshot?.latencyMs===undefined?'':` · ${Math.round(snapshot.latencyMs)} MS RTT`;this.setHudText('network',`ONLINE · ${(snapshot?.status??'connecting').toUpperCase()} · ${players.length}/${BOW_ROOM_CAP} PLAYERS${latency} · ROUND ${snapshot?.round??1} · FIRST TO ${limit}`);}
        else this.setHudText('board',this.bots.map(b=>`${b.name}    ${b.kills} K / ${b.deaths} D`).join('\n'));
        this.setHudText('health',`${this.hp}  HP`);this.setHudStyle('healthbar','width',`${this.hp*1.6}px`);this.setHudStyle('healthbar','background',this.hp<35?'#c9604c':'#b8c89a');this.setHudStyle('hit','opacity',String(this.hit));this.setHudStyle('damage','opacity',String(this.flash*.6));this.setHudText('feed',this.hp<=0?`YOU FELL · RESPAWNING IN ${Math.max(1,Math.ceil(this.deadUntil-this.elapsed))}`:this.elapsed<this.messageUntil?this.message:'');
        if(!online){const show=(!this.active||!!this.winner)&&!this.preview;this.setHudText('sub',this.preview?'MODEL INSPECTION · R RETURN TO MATCH':'BOW DEATHMATCH · LOCAL BOT ARENA');this.setHudStyle('modal','display',show?'block':'none');this.setHudText('title',this.winner?this.winner==='YOU'?'VICTORY':'MATCH OVER':'TIMBER / ASH');this.setHudText('description',this.winner?`${this.winner} reached ${this.config!.scoreLimit} eliminations.\nYour score: ${this.kills} kills / ${this.deaths} deaths`:`${this.config!.botCount} hunters. First to ${this.config!.scoreLimit} eliminations.\nHold to draw. Release to fire. Lead moving targets.\nArrows drop with distance. Rocks stop arrows.\nHeadshots deal extra damage. Respawn is automatic.`);this.setHudText('button',this.winner?'PLAY AGAIN':this.elapsed>0?'RESUME HUNT':'ENTER ARENA');return;}
        const status=snapshot?.status??'connecting',blocked=status==='full'||status==='reconnecting'||status==='disconnected'||status==='connecting',show=!this.active||!!this.winner||blocked;this.setHudText('sub','BOW DEATHMATCH · ONLINE · NO BOTS');this.setHudStyle('modal','display',show?'block':'none');this.setHudText('title',status==='full'?'SERVER FULL':this.winner?this.winner==='YOU'?'VICTORY':'ROUND OVER':'TIMBER / ASH');
        this.setHudText('description',status==='full'?`The main room already has ${BOW_ROOM_CAP} archers.\nTry again later or continue in solo mode.`:status==='reconnecting'||status==='disconnected'?'Connection lost. Reconnecting with backoff.\nYou can continue immediately in solo mode.':status==='connecting'?'Connecting to the main room…':this.winner?`${this.winner} reached ${limit} eliminations.\nThe next round begins in about 5 seconds.`:`${snapshot?.players.length??0} archers online. First to ${limit} eliminations.\nNo bots online. Hits use the trusted-friends model.\nHeadshots deal extra damage. Respawn is automatic.`);
        const disabled=blocked||!!this.winner;this.setHudDisabled('button',disabled);this.setHudStyle('button','opacity',disabled?'.55':'1');this.setHudText('button',this.winner?'ROUND RESTARTS SOON':blocked?status==='full'?'ROOM UNAVAILABLE':'CONNECTING…':this.elapsed>0?'RESUME HUNT':'ENTER ARENA');this.setHudStyle('name','display',this.winner||status==='full'?'none':'block');this.setHudStyle('solo','display',blocked?'block':'none');
    }
}
