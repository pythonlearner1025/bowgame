import type {ThreeViewer} from 'threepipe';

export type NetworkDirection='inbound'|'outbound';
export interface BowTelemetrySink {
    recordNetwork(direction:NetworkDirection,type:string,bytes:number):void;
    recordReconnect(attempt:number,delayMs:number):void;
    recordSocketClose(code:number,wasClean:boolean):void;
    recordRtt(rttMs:number):void;
    setRemotePlayers(playerIds:string[]):void;
    recordRemoteState(playerId:string):void;
    removeRemotePlayer(playerId:string):void;
}

interface MessageCounter {count:number;bytes:number}
interface CanvasMetrics {width:number;height:number;clientWidth:number;clientHeight:number;devicePixelRatio:number;rendererPixelRatio:number;renderScale:number}
interface TelemetrySample {
    at:string;windowMs:number;visible:boolean;activeFrames:number;
    frameTimeMs:{count:number;p50:number;p95:number;max:number};
    gameCpuMs:{count:number;p50:number;p95:number;max:number};
    renders:number;rAFGaps:{at:string;gapMs:number;visible:boolean}[];
    rttMs:number[];
    network:{inbound:{count:number;bytes:number;byType:Record<string,MessageCounter>};outbound:{count:number;bytes:number;byType:Record<string,MessageCounter>}};
    reconnects:{at:string;attempt:number;delayMs:number}[];
    socketCloses:{at:string;code:number;wasClean:boolean}[];
    canvas:CanvasMetrics|null;canvasChanges:{at:string;from:CanvasMetrics|null;to:CanvasMetrics}[];
    longTasks:{at:string;durationMs:number}[];
    remoteStateStaleness:{players:{playerId:string;ms:number|null}[];maxMs:number|null};
}

const FRAME_CAPACITY=512,TELEMETRY_SECONDS=300;
const round=(value:number)=>Number(value.toFixed(2));
const epochIso=(performanceTime:number)=>new Date(performance.timeOrigin+performanceTime).toISOString();

export function utf8ByteLength(value:string){
    let bytes=0;
    for(let i=0;i<value.length;i++){
        const code=value.charCodeAt(i);
        if(code<0x80)bytes++;
        else if(code<0x800)bytes+=2;
        else if(code>=0xd800&&code<=0xdbff&&i+1<value.length&&value.charCodeAt(i+1)>=0xdc00&&value.charCodeAt(i+1)<=0xdfff){bytes+=4;i++;}
        else bytes+=3;
    }
    return bytes;
}

export function summarizeFrameTimes(values:number[]){
    if(!values.length)return {count:0,p50:0,p95:0,max:0};
    values.sort((a,b)=>a-b);const at=(p:number)=>values[Math.min(values.length-1,Math.floor(values.length*p))];
    return {count:values.length,p50:round(at(.5)),p95:round(at(.95)),max:round(values[values.length-1])};
}

export class TelemetryRing<T> {
    private values:(T|undefined)[];private next=0;private count=0;
    constructor(readonly capacity:number){if(!Number.isInteger(capacity)||capacity<1)throw new Error('Telemetry ring capacity must be positive');this.values=new Array(capacity);}
    push(value:T){this.values[this.next]=value;this.next=(this.next+1)%this.capacity;this.count=Math.min(this.count+1,this.capacity);}
    toArray(){const result:T[]=[];const start=(this.next-this.count+this.capacity)%this.capacity;for(let i=0;i<this.count;i++){const value=this.values[(start+i)%this.capacity];if(value!==undefined)result.push(value);}return result;}
    get length(){return this.count;}
}

/** Five-minute client recorder. Per-frame work writes only into fixed typed arrays. */
export class BowPerformance implements BowTelemetrySink {
    private viewer:ThreeViewer|null=null;private readonly ring=new TelemetryRing<TelemetrySample>(TELEMETRY_SECONDS);
    private readonly frameTimes=new Float32Array(FRAME_CAPACITY);private readonly cpuTimes=new Float32Array(FRAME_CAPACITY);private frameCount=0;private activeFrames=0;
    private rendered=0;private previousRendered=0;private renderStart=0;private renderMs=0;private calls=0;private triangles=0;private gpuMs:number|null=null;private query:any=null;private pending:any[]=[];private frames=0;private gl:any=null;private extension:any=null;
    private inbound:Record<string,MessageCounter>=Object.create(null);private outbound:Record<string,MessageCounter>=Object.create(null);
    private rAFGaps:{at:string;gapMs:number;visible:boolean}[]=[];private rttSamples:number[]=[];private reconnects:{at:string;attempt:number;delayMs:number}[]=[];private socketCloses:{at:string;code:number;wasClean:boolean}[]=[];private canvasChanges:{at:string;from:CanvasMetrics|null;to:CanvasMetrics}[]=[];private longTasks:{at:string;durationMs:number}[]=[];
    private readonly remoteStateAt=new Map<string,number|null>();private lastCanvas:CanvasMetrics|null=null;private sampleStarted=performance.now();private interval:number|null=null;private observer:PerformanceObserver|null=null;private overlay:HTMLPreElement|null=null;private overlayVisible=false;

    constructor(){
        if(typeof window!=='undefined')window.addEventListener('keydown',this.onKeyDown,true);
        if(typeof PerformanceObserver!=='undefined'&&PerformanceObserver.supportedEntryTypes?.includes('longtask')){
            this.observer=new PerformanceObserver(list=>{for(const entry of list.getEntries())this.longTasks.push({at:epochIso(entry.startTime),durationMs:round(entry.duration)});});
            this.observer.observe({type:'longtask',buffered:true});
        }
    }
    attachViewer(viewer:ThreeViewer){
        if(this.viewer===viewer)return;this.detachViewer();this.viewer=viewer;this.gl=viewer.renderManager.renderer.getContext();this.extension=this.gl.getExtension('EXT_disjoint_timer_query_webgl2');
        viewer.addEventListener('preRender',this.beforeRender);viewer.addEventListener('postRender',this.afterRender);this.captureCanvas(performance.now());this.sampleStarted=performance.now();
        this.interval=window.setInterval(()=>this.flush(performance.now()),1000);
    }
    detachViewer(){
        if(this.viewer){this.viewer.removeEventListener('preRender',this.beforeRender);this.viewer.removeEventListener('postRender',this.afterRender);}
        if(this.interval!==null)window.clearInterval(this.interval);this.interval=null;
        if(this.query&&this.gl&&this.extension){this.gl.endQuery(this.extension.TIME_ELAPSED_EXT);this.gl.deleteQuery(this.query);}for(const query of this.pending)try{this.gl?.deleteQuery(query);}catch{}
        this.query=null;this.pending=[];this.viewer=null;this.gl=this.extension=null;
    }
    private beforeRender=()=>{
        this.renderStart=performance.now();if(!this.extension||!this.gl)return;const gl=this.gl,ext=this.extension;
        while(this.pending.length&&gl.getQueryParameter(this.pending[0],gl.QUERY_RESULT_AVAILABLE)){const query=this.pending.shift();if(!gl.getParameter(ext.GPU_DISJOINT_EXT))this.gpuMs=gl.getQueryParameter(query,gl.QUERY_RESULT)/1e6;gl.deleteQuery(query);}
        if(++this.frames%12===0&&this.pending.length<3&&!gl.getQuery(ext.TIME_ELAPSED_EXT,gl.CURRENT_QUERY)){this.query=gl.createQuery();gl.beginQuery(ext.TIME_ELAPSED_EXT,this.query);}
    };
    private afterRender=()=>{
        this.rendered++;this.renderMs=performance.now()-this.renderStart;if(!this.viewer)return;const renderer=this.viewer.renderManager.renderer;this.calls=renderer.info.render.calls;this.triangles=renderer.info.render.triangles;
        if(this.query&&this.gl&&this.extension){this.gl.endQuery(this.extension.TIME_ELAPSED_EXT);this.pending.push(this.query);this.query=null;}
    };
    record(at:number,frameMs:number,cpuMs:number,active:boolean){
        const index=this.frameCount%FRAME_CAPACITY;this.frameTimes[index]=Math.max(0,frameMs);this.cpuTimes[index]=Math.max(0,cpuMs);this.frameCount++;if(active)this.activeFrames++;
        if(frameMs>100)this.rAFGaps.push({at:epochIso(at),gapMs:round(frameMs),visible:document.visibilityState==='visible'});
        this.captureCanvas(at);
    }
    recordNetwork(direction:NetworkDirection,type:string,bytes:number){const counters=direction==='inbound'?this.inbound:this.outbound,entry=counters[type]??={count:0,bytes:0};entry.count++;entry.bytes+=bytes;}
    recordReconnect(attempt:number,delayMs:number){this.reconnects.push({at:new Date().toISOString(),attempt,delayMs:round(delayMs)});}
    recordSocketClose(code:number,wasClean:boolean){this.socketCloses.push({at:new Date().toISOString(),code,wasClean});}
    recordRtt(rttMs:number){this.rttSamples.push(round(rttMs));}
    setRemotePlayers(playerIds:string[]){const wanted=new Set(playerIds);for(const id of this.remoteStateAt.keys())if(!wanted.has(id))this.remoteStateAt.delete(id);for(const id of wanted)if(!this.remoteStateAt.has(id))this.remoteStateAt.set(id,null);}
    recordRemoteState(playerId:string){this.remoteStateAt.set(playerId,performance.now());}
    removeRemotePlayer(playerId:string){this.remoteStateAt.delete(playerId);}
    private canvasMetrics():CanvasMetrics|null {if(!this.viewer)return null;const canvas=this.viewer.canvas,renderer=this.viewer.renderManager.renderer;return {width:canvas.width,height:canvas.height,clientWidth:canvas.clientWidth,clientHeight:canvas.clientHeight,devicePixelRatio,rendererPixelRatio:renderer.getPixelRatio(),renderScale:this.viewer.renderManager.renderScale};}
    private captureCanvas(at:number){
        if(!this.viewer)return;const canvas=this.viewer.canvas,renderer=this.viewer.renderManager.renderer,last=this.lastCanvas,width=canvas.width,height=canvas.height,clientWidth=canvas.clientWidth,clientHeight=canvas.clientHeight,dpr=devicePixelRatio,rendererPixelRatio=renderer.getPixelRatio(),renderScale=this.viewer.renderManager.renderScale;
        if(last&&last.width===width&&last.height===height&&last.clientWidth===clientWidth&&last.clientHeight===clientHeight&&last.devicePixelRatio===dpr&&last.rendererPixelRatio===rendererPixelRatio&&last.renderScale===renderScale)return;
        const next={width,height,clientWidth,clientHeight,devicePixelRatio:dpr,rendererPixelRatio,renderScale};this.canvasChanges.push({at:epochIso(at),from:last,to:next});this.lastCanvas=next;
    }
    private totals(byType:Record<string,MessageCounter>){let count=0,bytes=0;for(const value of Object.values(byType)){count+=value.count;bytes+=value.bytes;}return {count,bytes,byType};}
    private frameValues(source:Float32Array){const count=Math.min(this.frameCount,FRAME_CAPACITY),values:number[]=[];const start=this.frameCount>FRAME_CAPACITY?this.frameCount%FRAME_CAPACITY:0;for(let i=0;i<count;i++)values.push(source[(start+i)%FRAME_CAPACITY]);return values;}
    private flush(now:number,force=false){
        const windowMs=now-this.sampleStarted;if(!force&&windowMs<900)return;
        const stalePlayers=[...this.remoteStateAt].map(([playerId,at])=>({playerId,ms:at===null?null:round(Math.max(0,now-at))})),staleValues=stalePlayers.flatMap(player=>player.ms===null?[]:[player.ms]);
        const sample:TelemetrySample={at:epochIso(now),windowMs:round(windowMs),visible:document.visibilityState==='visible',activeFrames:this.activeFrames,frameTimeMs:summarizeFrameTimes(this.frameValues(this.frameTimes)),gameCpuMs:summarizeFrameTimes(this.frameValues(this.cpuTimes)),renders:this.rendered-this.previousRendered,rAFGaps:this.rAFGaps,rttMs:this.rttSamples,network:{inbound:this.totals(this.inbound),outbound:this.totals(this.outbound)},reconnects:this.reconnects,socketCloses:this.socketCloses,canvas:this.canvasMetrics(),canvasChanges:this.canvasChanges,longTasks:this.longTasks,remoteStateStaleness:{players:stalePlayers,maxMs:staleValues.length?Math.max(...staleValues):null}};
        this.ring.push(sample);this.previousRendered=this.rendered;this.frameCount=this.activeFrames=0;this.inbound=Object.create(null);this.outbound=Object.create(null);this.rAFGaps=[];this.rttSamples=[];this.reconnects=[];this.socketCloses=[];this.canvasChanges=[];this.longTasks=[];this.sampleStarted=now;this.refreshOverlay(sample);
    }
    private ensureOverlay(){
        if(this.overlay)return;const overlay=document.createElement('pre');overlay.id='kite3d-bow-debug';overlay.style.cssText='position:fixed;z-index:20000;left:10px;bottom:10px;margin:0;padding:9px 11px;background:#07100ddd;border:1px solid #82927b;color:#dff0d7;font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;pointer-events:none;white-space:pre;display:none';document.body.append(overlay);this.overlay=overlay;
    }
    private refreshOverlay(sample:TelemetrySample){if(!this.overlayVisible)return;this.ensureOverlay();const frame=sample.frameTimeMs,netIn=sample.network.inbound,netOut=sample.network.outbound,stale=sample.remoteStateStaleness.maxMs,rtt=sample.rttMs.at(-1);const value=`BOW DEBUG · F8 hide · F9 export\nframe ${frame.p50}/${frame.p95}/${frame.max} ms · gaps ${sample.rAFGaps.length} · long ${sample.longTasks.length}\nRTT ${rtt??'—'} ms · remote stale ${stale??'—'} ms\nWS ↓ ${netIn.count}/${netIn.bytes} B · ↑ ${netOut.count}/${netOut.bytes} B\ncanvas ${sample.canvas?.width??0}×${sample.canvas?.height??0} · DPR ${sample.canvas?.devicePixelRatio??0} · scale ${sample.canvas?.renderScale??0}`;if(this.overlay!.textContent!==value)this.overlay!.textContent=value;}
    private onKeyDown=(event:KeyboardEvent)=>{
        if(event.code==='F8'){event.preventDefault();this.overlayVisible=!this.overlayVisible;this.ensureOverlay();this.overlay!.style.display=this.overlayVisible?'block':'none';const latest=this.ring.toArray().at(-1);if(latest)this.refreshOverlay(latest);}
        else if(event.code==='F9'){event.preventDefault();this.download();}
    };
    exportData(){this.flush(performance.now(),true);return {schemaVersion:1,exportedAt:new Date().toISOString(),timeOrigin:new Date(performance.timeOrigin).toISOString(),userAgent:navigator.userAgent,samples:this.ring.toArray()};}
    download(){const blob=new Blob([JSON.stringify(this.exportData(),null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`bowgame-telemetry-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),0);}
    summary(){const sample=this.ring.toArray().at(-1),canvas=this.canvasMetrics();return {visible:document.visibilityState==='visible',allVisible:sample?.frameTimeMs??null,activeCombat:{frames:sample?.activeFrames??0},lastRenderCpuMs:round(this.renderMs),lastGpuMs:this.gpuMs===null?null:round(this.gpuMs),drawCalls:this.calls,triangles:this.triangles,canvas,gpuTimerSupported:!!this.extension,hardwareConcurrency:navigator.hardwareConcurrency,rendererGeometries:this.viewer?.renderManager.renderer.info.memory.geometries??0,telemetrySamples:this.ring.length};}
    dispose(){this.detachViewer();window.removeEventListener('keydown',this.onKeyDown,true);this.observer?.disconnect();this.observer=null;this.overlay?.remove();this.overlay=null;}
}
