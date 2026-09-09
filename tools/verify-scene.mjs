import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const bytes=await readFile(resolve(root,'assets/main.scene.glb'));
assert.equal(bytes.toString('ascii',0,4),'glTF');
assert.equal(bytes.readUInt32LE(4),2);
assert.equal(bytes.readUInt32LE(8),bytes.length);
const jsonLength=bytes.readUInt32LE(12);
assert.equal(bytes.toString('ascii',16,20),'JSON');
const gltf=JSON.parse(bytes.toString('utf8',20,20+jsonLength).trimEnd());
const arena=gltf.nodes.find(node=>node.name==='K3D_BOW_DEMO_ARENA');
assert.ok(arena,'authored arena group is present');
assert.equal(arena.mesh,undefined,'fallback GLB intentionally has no baked geometry');
assert.deepEqual(arena.extras.EntityComponentPlugin['bow-game'],{
  type:'BowGameComponent',
  state:{botCount:3,scoreLimit:10,difficulty:'normal'},
});
assert.deepEqual(arena.extras.kite3dBowArena,{runtimeOnly:true,seed:'BowArena.seededRandom:73429'});
console.log(`verified GLB v2: ${bytes.length} bytes, ${gltf.nodes.length} node, component=BowGameComponent, bots=3, score=10, difficulty=normal, runtimeOnly=true`);
