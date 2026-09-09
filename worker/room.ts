import {DurableObject} from 'cloudflare:workers';
import {cleanPlayerName,parseClientMessage,type ServerMessage} from '../src/BowProtocol.js';
import {ROOM_CAP,SCORE_LIMIT,RoomLogic,type RoomPlayer} from './roomLogic.js';

interface Attachment extends RoomPlayer {round:number;roundEnded:boolean}

export class BowRoom extends DurableObject<Env> {
    async fetch(request:Request):Promise<Response>{
        if(request.headers.get('Upgrade')?.toLowerCase()!=='websocket')return new Response('WebSocket upgrade required',{status:426});
        const sockets=this.ctx.getWebSockets();
        const pair=new WebSocketPair();const [client,server]=Object.values(pair);
        this.ctx.acceptWebSocket(server);
        if(sockets.length>=ROOM_CAP){server.send(this.encode({v:1,type:'full'}));server.close(1013,'Room full');return new Response(null,{status:101,webSocket:client});}

        const logic=this.logic();const id=crypto.randomUUID();const requested=new URL(request.url).searchParams.get('name');
        const player=logic.join(id,cleanPlayerName(requested));if(!player){server.send(this.encode({v:1,type:'full'}));server.close(1013,'Room full');return new Response(null,{status:101,webSocket:client});}
        const attachment:Attachment={...player,round:logic.round,roundEnded:logic.roundEnded};server.serializeAttachment(attachment);
        server.send(this.encode({v:1,type:'welcome',playerId:id,roster:[...logic.players.values()].map(({id,name,slot})=>({id,name,slot})),scores:logic.scores(),scoreLimit:SCORE_LIMIT,round:logic.round}));
        this.broadcast({v:1,type:'join',playerId:id,name:player.name,slot:player.slot},server);
        return new Response(null,{status:101,webSocket:client});
    }

    async webSocketMessage(ws:WebSocket,raw:string|ArrayBuffer):Promise<void>{
        if(typeof raw!=='string'){ws.close(1003,'JSON text only');return;}
        let decoded:unknown;try{decoded=JSON.parse(raw);}catch{ws.close(1003,'Invalid JSON');return;}
        const message=parseClientMessage(decoded);if(!message){ws.close(1003,'Invalid protocol message');return;}
        const attachment=this.attachment(ws);if(!attachment){ws.close(1011,'Missing player state');return;}
        switch(message.type){
            case'join':attachment.name=message.name;ws.serializeAttachment(attachment);this.broadcast({v:1,type:'join',playerId:attachment.id,name:attachment.name,slot:attachment.slot});break;
            case'state':this.broadcast({...message,playerId:attachment.id},ws);break;
            case'shot':this.broadcast({...message,playerId:attachment.id},ws);break;
            case'hit':this.broadcast({...message,playerId:attachment.id},ws);break;
            case'death':{
                const logic=this.logic(),result=logic.death(attachment.id,message.killerId);if(!result.accepted)break;
                this.sync(logic);this.broadcast({v:1,type:'death',playerId:attachment.id,killerId:message.killerId});this.broadcast({v:1,type:'scores',scores:result.scores});
                if(result.winnerId){this.broadcast({v:1,type:'round_end',winnerId:result.winnerId,scores:result.scores});await this.ctx.storage.setAlarm(Date.now()+5_000);}
                break;
            }
            case'ping':ws.send(this.encode({v:1,type:'pong',sentAt:message.sentAt}));break;
        }
    }
    webSocketClose(ws:WebSocket,code:number,reason:string):void{const player=this.attachment(ws);if(player)this.broadcast({v:1,type:'leave',playerId:player.id},ws);try{ws.close(code,reason);}catch{}}
    webSocketError(ws:WebSocket):void{const player=this.attachment(ws);if(player)this.broadcast({v:1,type:'leave',playerId:player.id},ws);try{ws.close(1011,'WebSocket error');}catch{}}
    async alarm():Promise<void>{
        const logic=this.logic();if(!logic.roundEnded)return;
        const reset=logic.reset();this.sync(logic);this.broadcast({v:1,type:'round_reset',round:reset.round});
    }
    private attachment(ws:WebSocket){const value=ws.deserializeAttachment();return value&&typeof value==='object'?value as Attachment:null;}
    private logic(){
        const attachments=this.ctx.getWebSockets().map(ws=>this.attachment(ws)).filter((value):value is Attachment=>value!==null);
        const round=Math.max(1,...attachments.map(player=>player.round));const roundEnded=attachments.some(player=>player.roundEnded);
        return new RoomLogic(round,roundEnded,attachments.map(({id,name,slot,kills})=>({id,name,slot,kills})));
    }
    private sync(logic:RoomLogic){for(const ws of this.ctx.getWebSockets()){const attachment=this.attachment(ws),player=attachment&&logic.players.get(attachment.id);if(player)ws.serializeAttachment({...player,round:logic.round,roundEnded:logic.roundEnded} satisfies Attachment);}}
    private encode(message:ServerMessage){return JSON.stringify(message);}
    private broadcast(message:ServerMessage,except?:WebSocket){const encoded=this.encode(message);for(const socket of this.ctx.getWebSockets())if(socket!==except)try{socket.send(encoded);}catch{}}
}
