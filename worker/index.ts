export {BowRoom} from './room.js';

export default {
    async fetch(request:Request,env:Env):Promise<Response>{
        const url=new URL(request.url);
        if(url.pathname==='/ws'){
            if(request.headers.get('Upgrade')?.toLowerCase()!=='websocket')return new Response('WebSocket upgrade required',{status:426});
            const room=(url.searchParams.get('room')||'main').slice(0,64);
            return env.BOW_ROOM.getByName(room).fetch(request);
        }
        return env.ASSETS.fetch(request);
    },
} satisfies ExportedHandler<Env>;
