/** Pure collision/ballistics helpers shared by the browser runtime and its tests. */
export interface Vec {x: number; y: number; z: number}
export interface Cover {x: number; z: number; r: number; height: number}
export const GRAVITY = 9.81;
export const BOW_DRAW_SECONDS = 1.15;
export function shotSpeed(charge: number) { return 18 + Math.min(1, Math.max(0, charge)) * 38; }
export function shotDamage(charge: number, headshot = false) { return Math.round((24 + Math.min(1, Math.max(0, charge)) * 46) * (headshot ? 1.8 : 1)); }
/** Earliest segment/sphere intersection in [0,1]; swept tests prevent tunnelling. */
export function segmentSphere(a: Vec, b: Vec, c: Vec, radius: number): number | null {
    const dx=b.x-a.x, dy=b.y-a.y, dz=b.z-a.z;
    const ox=a.x-c.x, oy=a.y-c.y, oz=a.z-c.z;
    const aa=dx*dx+dy*dy+dz*dz, cc=ox*ox+oy*oy+oz*oz-radius*radius;
    if (cc<=0) return 0;
    if (aa<1e-12) return null;
    const bb=2*(ox*dx+oy*dy+oz*dz), disc=bb*bb-4*aa*cc;
    if(disc<0) return null;
    const t=(-bb-Math.sqrt(disc))/(2*aa);
    return t>=0 && t<=1 ? t : null;
}
/** Vertical cylinder covers include top/bottom caps, not just a horizontal radius. */
export function segmentCover(a: Vec, b: Vec, c: Cover): number | null {
    const dx=b.x-a.x,dz=b.z-a.z,dy=b.y-a.y,ox=a.x-c.x,oz=a.z-c.z;
    const aa=dx*dx+dz*dz,bb=2*(ox*dx+oz*dz),cc=ox*ox+oz*oz-c.r*c.r;
    let lo=0,hi=1;
    if (aa<1e-12) {if(cc>0)return null;}
    else {const d=bb*bb-4*aa*cc;if(d<0)return null;lo=Math.max(lo,(-bb-Math.sqrt(d))/(2*aa));hi=Math.min(hi,(-bb+Math.sqrt(d))/(2*aa));}
    if(Math.abs(dy)<1e-12) {if(a.y<0 || a.y>c.height)return null;}
    else {const t0=-a.y/dy,t1=(c.height-a.y)/dy;lo=Math.max(lo,Math.min(t0,t1));hi=Math.min(hi,Math.max(t0,t1));}
    return lo<=hi ? lo : null;
}
export function moveWithCover(position: Vec, dx: number, dz: number, covers: Cover[], radius=0.38) {
    const next={x:position.x+dx,y:position.y,z:position.z+dz};
    const distance=Math.hypot(next.x,next.z);if(distance>27){next.x*=27/distance;next.z*=27/distance;}
    for(let pass=0;pass<2;pass++) for(const c of covers) {
        const x=next.x-c.x,z=next.z-c.z,d=Math.hypot(x,z),min=c.r+radius;
        if(d<min){if(d>0.0001){next.x=c.x+x/d*min;next.z=c.z+z/d*min;}else{next.x=c.x+min;}}
    }
    return next;
}
