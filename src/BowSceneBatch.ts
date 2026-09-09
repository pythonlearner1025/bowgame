import {Group,InstancedMesh,Matrix4,Mesh,SphereGeometry} from 'threepipe';
/** Batch identical static arena surfaces in spatial cells; preserve authored scene objects for editing. */
export function batchBowScene(arena:Group,runtime:Group){
    const originals:{mesh:Mesh;visible:boolean;matrixAutoUpdate:boolean}[]=[],batches:InstancedMesh[]=[],geometries:{mesh:InstancedMesh;original:any;replacement:SphereGeometry}[]=[];
    const groups=new Map<string,Mesh[]>();arena.updateWorldMatrix(true,true);runtime.updateWorldMatrix(true,false);
    arena.traverseVisible(object=>{
        const mesh=object as Mesh;if(!mesh.isMesh||(mesh as any).isSkinnedMesh)return;
        if((mesh as InstancedMesh).isInstancedMesh){
            if(/^Forest[ _]scree$/.test(mesh.name)){
                const replacement=new SphereGeometry(1,10,6),p=replacement.getAttribute('position');
                for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i),z=p.getZ(i),d=1+.15*Math.sin(x*4+z*3)*Math.cos(y*4)+.045*Math.sin(x*13-z*8)*Math.cos(y*11);p.setXYZ(i,x*d,y*d,z*d);}
                replacement.computeVertexNormals();geometries.push({mesh:mesh as InstancedMesh,original:mesh.geometry,replacement});mesh.geometry=replacement;
            }
            return;
        }
        if(Array.isArray(mesh.material))return;
        const e=mesh.matrixWorld.elements,key=[mesh.geometry.uuid,mesh.material.uuid,mesh.castShadow,mesh.receiveShadow,Math.floor(e[12]/18),Math.floor(e[14]/18)].join(':');
        const group=groups.get(key)??[];group.push(mesh);groups.set(key,group);
    });
    const inverse=runtime.matrixWorld.clone().invert(),matrix=new Matrix4();
    for(const meshes of groups.values()){
        if(meshes.length<2)continue;const first=meshes[0],batch=new InstancedMesh(first.geometry,first.material,meshes.length);
        batch.name='Static arena batch: '+first.name;batch.castShadow=first.castShadow;batch.receiveShadow=first.receiveShadow;
        meshes.forEach((mesh,i)=>{batch.setMatrixAt(i,matrix.copy(inverse).multiply(mesh.matrixWorld));originals.push({mesh,visible:mesh.visible,matrixAutoUpdate:mesh.matrixAutoUpdate});mesh.visible=false;mesh.matrixAutoUpdate=false;});
        batch.computeBoundingSphere();runtime.add(batch);batches.push(batch);
    }
    return {originalMeshes:originals.length,batches:batches.length,dispose(){
        for(const batch of batches){batch.removeFromParent();batch.dispose();}
        for(const state of originals){state.mesh.visible=state.visible;state.mesh.matrixAutoUpdate=state.matrixAutoUpdate;}
        for(const state of geometries){state.mesh.geometry=state.original;state.replacement.dispose();}
    }};
}
