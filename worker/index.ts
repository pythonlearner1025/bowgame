export {BowRoom} from './room.js';

export default {
    async fetch(request:Request,env:Env):Promise<Response>{
        const url=new URL(request.url);
        try{
            if(url.pathname==='/ws'){
                if(request.headers.get('Upgrade')?.toLowerCase()!=='websocket')return new Response('WebSocket upgrade required',{status:426});
                const room=(url.searchParams.get('room')||'main').slice(0,64);
                return await env.BOW_ROOM.getByName(room).fetch(request);
            }
            return await env.ASSETS.fetch(request);
        }catch(error){
            console.error(JSON.stringify({service:'bow_worker',event:'exception',timestamp:new Date().toISOString(),handler:'fetch',path:url.pathname,errorName:error instanceof Error?error.name:'UnknownError',errorMessage:error instanceof Error?error.message:String(error)}));
            return new Response('Worker unavailable',{status:500});
        }
    },
} satisfies ExportedHandler<Env>;
