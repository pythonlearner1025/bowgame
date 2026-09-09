import type {ThreeViewer} from 'threepipe';
type Sample={at:number;dt:number;cpu:number;active:boolean;visible:boolean;rendered:number};
/** Read-only real-frame telemetry; explicit screenshot frames never count as game FPS. */
export class BowPerformance {
    private rendered=0;private previousRendered=0;private samples:Sample[]=[];private renderStart=0;private renderMs=0;private calls=0;private triangles=0;
    private gpuMs:number|null=null;private query:any=null;private pending:any[]=[];private frames=0;private gl:any;private extension:any;
    constructor(private viewer:ThreeViewer){
        this.gl=viewer.renderManager.renderer.getContext();this.extension=this.gl.getExtension('EXT_disjoint_timer_query_webgl2');
        viewer.addEventListener('preRender',this.beforeRender);viewer.addEventListener('postRender',this.afterRender);
    }
    private beforeRender=()=>{
        this.renderStart=performance.now();
        if(!this.extension)return;const gl=this.gl,ext=this.extension;
        while(this.pending.length&&gl.getQueryParameter(this.pending[0],gl.QUERY_RESULT_AVAILABLE)){
            const query=this.pending.shift();if(!gl.getParameter(ext.GPU_DISJOINT_EXT))this.gpuMs=gl.getQueryParameter(query,gl.QUERY_RESULT)/1e6;gl.deleteQuery(query);
        }
        if(++this.frames%12===0&&this.pending.length<3&&!gl.getQuery(ext.TIME_ELAPSED_EXT,gl.CURRENT_QUERY)){
            this.query=gl.createQuery();gl.beginQuery(ext.TIME_ELAPSED_EXT,this.query);
        }
    };
    private afterRender=()=>{
        this.rendered++;this.renderMs=performance.now()-this.renderStart;const renderer=this.viewer.renderManager.renderer;
        this.calls=renderer.info.render.calls;this.triangles=renderer.info.render.triangles;
        if(this.query){this.gl.endQuery(this.extension.TIME_ELAPSED_EXT);this.pending.push(this.query);this.query=null;}
    };
    record(at:number,dt:number,cpu:number,active:boolean){
        this.samples.push({at,dt,cpu,active,visible:document.visibilityState==='visible',rendered:this.rendered-this.previousRendered});this.previousRendered=this.rendered;
        while(this.samples.length>7200||this.samples[0]?.at<at-60000)this.samples.shift();
    }
    summary(){
        const frames=this.samples.filter(s=>s.visible&&s.dt>0),active=frames.filter(s=>s.active);
        const statistics=(list:Sample[])=>{const intervals=list.map(s=>s.dt).sort((a,b)=>a-b),cpu=list.map(s=>s.cpu).sort((a,b)=>a-b),sum=intervals.reduce((a,b)=>a+b,0),at=(a:number[],p:number)=>a[Math.min(a.length-1,Math.floor(a.length*p))]??0;const rendered=list.reduce((sum,s)=>sum+s.rendered,0);return {samples:list.length,renderedFrames:rendered,renderFps:sum?Number((rendered*1000/sum).toFixed(1)):0,longFrames:list.filter(s=>s.dt>=250).length,maxFrameMs:Number((intervals[intervals.length-1]??0).toFixed(2)),seconds:Number((sum/1000).toFixed(2)),fps:sum?Number((list.length*1000/sum).toFixed(1)):0,frameMsP50:Number(at(intervals,.5).toFixed(2)),frameMsP95:Number(at(intervals,.95).toFixed(2)),gameCpuMsP50:Number(at(cpu,.5).toFixed(2)),gameCpuMsP95:Number(at(cpu,.95).toFixed(2))};};
        const r=this.viewer.renderManager,canvas=this.viewer.canvas;
        return {visible:document.visibilityState==='visible',allVisible:statistics(frames),activeCombat:statistics(active),lastRenderCpuMs:Number(this.renderMs.toFixed(2)),lastGpuMs:this.gpuMs===null?null:Number(this.gpuMs.toFixed(2)),drawCalls:this.calls,triangles:this.triangles,canvas:{width:canvas.width,height:canvas.height,dpr:devicePixelRatio,renderScale:r.renderScale},gpuTimerSupported:!!this.extension,hardwareConcurrency:navigator.hardwareConcurrency,rendererGeometries:r.renderer.info.memory.geometries};
    }
    dispose(){this.viewer.removeEventListener('preRender',this.beforeRender);this.viewer.removeEventListener('postRender',this.afterRender);if(this.query){this.gl.endQuery(this.extension.TIME_ELAPSED_EXT);this.gl.deleteQuery(this.query);}for(const query of this.pending)this.gl.deleteQuery(query);this.pending=[];}
}
