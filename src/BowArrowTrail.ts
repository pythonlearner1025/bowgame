import {BufferAttribute,BufferGeometry,Group,Mesh,ShaderMaterial,Vector3,DoubleSide} from 'threepipe';

export const ARROW_TRAIL_SECONDS=.16;
export const ARROW_TRAIL_CAPACITY=32;
const POINTS=24,WIDTH=.046;
export interface ArrowTrailHandle {slot:number;generation:number}
interface Slot {mesh:Mesh;positions:Float32Array;alpha:Float32Array;points:Vector3[];times:Float64Array;count:number;generation:number;active:boolean;stopped:boolean;last:number}
/** Short camera-facing ribbons through actual collision-clipped physics samples. */
export class BowArrowTrails {
    readonly root=new Group();
    private slots:Slot[]=[];
    private serial=0;
    private material=new ShaderMaterial({transparent:true,depthWrite:false,depthTest:true,side:DoubleSide,toneMapped:false,
        vertexShader:'attribute float trailAlpha; varying float vAlpha; void main(){vAlpha=trailAlpha;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
        fragmentShader:'varying float vAlpha; void main(){gl_FragColor=vec4(.97,.975,.95,vAlpha);}',
    });
    constructor(){this.root.name='K3D_BALLISTIC_ARROW_STREAKS';}
    private makeSlot():Slot {
        const positions=new Float32Array(POINTS*6),alpha=new Float32Array(POINTS*2),indices=[];
        for(let i=0;i<POINTS-1;i++){const n=i*2;indices.push(n,n+1,n+2,n+1,n+3,n+2);}
        const geometry=new BufferGeometry();geometry.setAttribute('position',new BufferAttribute(positions,3));geometry.setAttribute('trailAlpha',new BufferAttribute(alpha,1));geometry.setIndex(indices);geometry.setDrawRange(0,0);
        const mesh=new Mesh(geometry,this.material);mesh.frustumCulled=false;mesh.visible=false;mesh.renderOrder=2;this.root.add(mesh);
        return {mesh,positions,alpha,points:Array.from({length:POINTS},()=>new Vector3()),times:new Float64Array(POINTS),count:0,generation:0,active:false,stopped:false,last:0};
    }
    spawn(position:Vector3,time:number):ArrowTrailHandle {
        let slot=this.slots.findIndex(s=>!s.active);
        if(slot<0&&this.slots.length<ARROW_TRAIL_CAPACITY){slot=this.slots.length;this.slots.push(this.makeSlot());}
        if(slot<0)slot=this.slots.reduce((best,s,i)=>s.last<this.slots[best].last?i:best,0);
        const s=this.slots[slot];s.generation=++this.serial;s.active=true;s.stopped=false;s.count=1;s.points[0].copy(position);s.times[0]=s.last=time;s.mesh.visible=false;
        return {slot,generation:s.generation};
    }
    private get(handle:ArrowTrailHandle){const s=this.slots[handle.slot];return s?.active&&s.generation===handle.generation?s:undefined;}
    sample(handle:ArrowTrailHandle,position:Vector3,time:number){
        const s=this.get(handle);if(!s||s.stopped)return;
        if(s.count===POINTS){for(let i=1;i<POINTS;i++){s.points[i-1].copy(s.points[i]);s.times[i-1]=s.times[i];}s.count--;}
        s.points[s.count].copy(position);s.times[s.count++]=time;s.last=time;
    }
    stop(handle:ArrowTrailHandle){const s=this.get(handle);if(s)s.stopped=true;}
    remove(handle:ArrowTrailHandle){const s=this.get(handle);if(s){s.active=false;s.mesh.visible=false;}}
    update(time:number,camera:Vector3){
        const tangent=new Vector3(),toward=new Vector3(),side=new Vector3();
        for(const s of this.slots){
            if(!s.active)continue;
            if(time-s.last>=ARROW_TRAIL_SECONDS){s.active=false;s.mesh.visible=false;continue;}
            let start=0;while(start<s.count-1&&time-s.times[start]>=ARROW_TRAIL_SECONDS)start++;
            const count=s.count-start;s.mesh.visible=count>=2;
            for(let j=0;j<count;j++){
                const i=start+j,p=s.points[i],age=Math.max(0,time-s.times[i]);
                tangent.copy(s.points[Math.min(s.count-1,i+1)]).sub(s.points[Math.max(start,i-1)]).normalize();toward.copy(camera).sub(p).normalize();side.crossVectors(tangent,toward);
                if(side.lengthSq()<1e-8)side.set(1,0,0);else side.normalize();
                const fade=Math.max(0,1-age/ARROW_TRAIL_SECONDS),taper=Math.min(1,(j+1)/4),width=WIDTH*.5*Math.sqrt(fade)*taper;
                for(let edge=0;edge<2;edge++){const v=j*2+edge,o=v*3,sign=edge?1:-1;s.positions[o]=p.x+side.x*width*sign;s.positions[o+1]=p.y+side.y*width*sign;s.positions[o+2]=p.z+side.z*width*sign;s.alpha[v]=.92*Math.pow(fade,1.35)*taper;}
            }
            s.mesh.geometry.setDrawRange(0,Math.max(0,count-1)*6);s.mesh.geometry.getAttribute('position').needsUpdate=true;s.mesh.geometry.getAttribute('trailAlpha').needsUpdate=true;
        }
    }
    clear(){for(const s of this.slots){s.active=false;s.mesh.visible=false;s.count=0;}}
    dispose(){for(const s of this.slots)s.mesh.geometry.dispose();this.material.dispose();this.root.removeFromParent();this.slots=[];}
}
