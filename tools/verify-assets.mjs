import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const originalRoot='/Users/minjunes/Documents/ChatGPT/kite3d/upstream/packages/threepipe-blueprint-editor/public/assets';
const manifest=JSON.parse(await readFile(resolve(root,'assets.json'),'utf8'));
let originals=0;
for(const [id,entry] of Object.entries(manifest.files)){
  const bytes=await readFile(resolve(root,entry.path));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256,`${id} hash`);
  if(id==='main.scene.glb')continue;
  const original=await readFile(resolve(originalRoot,id));
  assert.equal(Buffer.compare(bytes,original),0,`${id} original bytes`);
  originals++;
}
console.log(`verified ${Object.keys(manifest.files).length} asset hashes and ${originals} byte-identical original copies`);
