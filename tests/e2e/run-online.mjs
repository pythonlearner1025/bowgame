import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {resolve} from 'node:path';

const root=resolve(new URL('../..',import.meta.url).pathname);
let worker=null,baseURL=process.env.BOWGAME_BASE_URL;

async function freePort(){
  const server=createServer();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const address=server.address(),port=typeof address==='object'&&address?address.port:0;await new Promise(resolve=>server.close(resolve));return port;
}
async function waitForWorker(url,child){
  const deadline=Date.now()+25_000;while(Date.now()<deadline){if(child.exitCode!==null)throw new Error(`wrangler dev exited with ${child.exitCode}`);try{const response=await fetch(url);if(response.ok)return;}catch{}await new Promise(resolve=>setTimeout(resolve,200));}throw new Error('wrangler dev did not become ready');
}
async function stopWorker(child){
  if(!child||child.exitCode!==null)return;child.kill('SIGTERM');await Promise.race([new Promise(resolve=>child.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,3000))]);if(child.exitCode===null)child.kill('SIGKILL');
}

try{
  if(!baseURL){
    const port=await freePort();baseURL=`http://127.0.0.1:${port}`;
    worker=spawn(resolve(root,'node_modules/.bin/wrangler'),['dev','--local','--port',String(port), '--log-level','warn'],{cwd:root,stdio:['ignore','pipe','pipe']});
    worker.stdout.on('data',chunk=>process.stdout.write(`[wrangler] ${chunk}`));worker.stderr.on('data',chunk=>process.stderr.write(`[wrangler] ${chunk}`));
    await waitForWorker(baseURL,worker);
  }
  const playwright=spawn(resolve(root,'node_modules/.bin/playwright'),['test','--config','tests/e2e/playwright.online.config.mjs'],{cwd:root,stdio:'inherit',env:{...process.env,BOWGAME_BASE_URL:baseURL,BOWGAME_EVIDENCE_MODE:baseURL.includes('workers.dev')?'live':'local'}});
  const code=await new Promise((resolve,reject)=>{playwright.once('error',reject);playwright.once('exit',value=>resolve(value??1));});if(code!==0)process.exitCode=code;
}finally{await stopWorker(worker);}
