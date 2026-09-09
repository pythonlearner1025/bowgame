import {DurableObject} from 'cloudflare:workers';
import {cleanPlayerName,parseClientMessage,type ServerMessage} from '../src/BowProtocol.js';
import {ROOM_CAP,SCORE_LIMIT,RoomLogic,type RoomPlayer} from './roomLogic.js';
import {RoomTelemetry,utf8MessageBytes} from './roomTelemetry.js';

interface Attachment extends RoomPlayer {round:number;roundEnded:boolean}

export class BowRoom extends DurableObject<Env> {
    private readonly telemetry:RoomTelemetry;
    constructor(ctx:DurableObjectState,env:Env){super(ctx,env);this.telemetry=new RoomTelemetry((entry,error)=>error?console.error(JSON.stringify(entry)):console.log(JSON.stringify(entry)));this.telemetry.event('hibernation_wake',{connectedCount:this.ctx.getWebSockets().length});}
    async fetch(request:Request):Promise<Response>{
        try{
            if(request.headers.get('Upgrade')?.toLowerCase()!=='websocket')return new Response('WebSocket upgrade required',{status:426});
            const sockets=this.ctx.getWebSockets();
            const pair=new WebSocketPair();const [client,server]=Object.values(pair);
            this.ctx.acceptWebSocket(server);
            if(sockets.length>=ROOM_CAP){this.send(server,{v:1,type:'full'});this.telemetry.event('full',{connectedCount:sockets.length,roomCap:ROOM_CAP});server.close(1013,'Room full');return new Response(null,{status:101,webSocket:client});}

            const logic=this.logic();const id=crypto.randomUUID();const requested=new URL(request.url).searchParams.get('name');
            const player=logic.join(id,cleanPlayerName(requested));if(!player){this.send(server,{v:1,type:'full'});this.telemetry.event('full',{connectedCount:sockets.length,roomCap:ROOM_CAP});server.close(1013,'Room full');return new Response(null,{status:101,webSocket:client});}
            const attachment:Attachment={...player,round:logic.round,roundEnded:logic.roundEnded};server.serializeAttachment(attachment);
            this.send(server,{v:1,type:'welcome',playerId:id,roster:[...logic.players.values()].map(({id,name,slot})=>({id,name,slot})),scores:logic.scores(),scoreLimit:SCORE_LIMIT,round:logic.round});
            this.broadcast({v:1,type:'join',playerId:id,name:player.name,slot:player.slot},server);this.telemetry.event('join',{playerId:id,slot:player.slot,connectedCount:logic.players.size});this.telemetry.flushIfDue(logic.players.size);
            return new Response(null,{status:101,webSocket:client});
        }catch(error){this.telemetry.exception('fetch',error,this.ctx.getWebSockets().length);return new Response('Room unavailable',{status:500});}
    }

    async webSocketMessage(ws:WebSocket,raw:string|ArrayBuffer):Promise<void>{
        try{
            if(typeof raw!=='string'){ws.close(1003,'JSON text only');return;}
            let decoded:unknown;try{decoded=JSON.parse(raw);}catch{ws.close(1003,'Invalid JSON');return;}
            const message=parseClientMessage(decoded);if(!message){ws.close(1003,'Invalid protocol message');return;}
            this.telemetry.recordInbound(message.type,utf8MessageBytes(raw));const attachment=this.attachment(ws);if(!attachment){ws.close(1011,'Missing player state');return;}
            switch(message.type){
                case'join':attachment.name=message.name;ws.serializeAttachment(attachment);this.broadcast({v:1,type:'join',playerId:attachment.id,name:attachment.name,slot:attachment.slot});break;
                case'state':this.broadcast({...message,playerId:attachment.id},ws);break;
                case'shot':this.broadcast({...message,playerId:attachment.id},ws);break;
                case'hit':this.broadcast({...message,playerId:attachment.id},ws);break;
                case'death':{
                    const logic=this.logic(),result=logic.death(attachment.id,message.killerId);if(!result.accepted)break;
                    this.sync(logic);this.broadcast({v:1,type:'death',playerId:attachment.id,killerId:message.killerId});this.broadcast({v:1,type:'scores',scores:result.scores});
                    if(result.winnerId){this.broadcast({v:1,type:'round_end',winnerId:result.winnerId,scores:result.scores});this.telemetry.event('round_end',{round:logic.round,winnerId:result.winnerId,connectedCount:logic.players.size});await this.ctx.storage.setAlarm(Date.now()+5_000);}
                    break;
                }
                case'ping':this.send(ws,{v:1,type:'pong',sentAt:message.sentAt});break;
            }
            this.telemetry.flushIfDue(this.ctx.getWebSockets().length);
        }catch(error){this.telemetry.exception('webSocketMessage',error,this.ctx.getWebSockets().length);try{ws.close(1011,'Room error');}catch(closeError){this.telemetry.exception('webSocketMessage.close',closeError,this.ctx.getWebSockets().length);}}
    }
    webSocketClose(ws:WebSocket,code:number,_reason:string,wasClean:boolean):void{try{const connectedCount=this.connectedCount(ws),player=this.attachment(ws);if(player){this.broadcast({v:1,type:'leave',playerId:player.id},ws);this.telemetry.event('leave',{playerId:player.id,slot:player.slot,code,wasClean,connectedCount});}this.telemetry.flushIfDue(connectedCount);}catch(error){this.telemetry.exception('webSocketClose',error,this.ctx.getWebSockets().length);}}
    webSocketError(ws:WebSocket,error:unknown):void{this.telemetry.exception('webSocketError',error,this.ctx.getWebSockets().length);try{const player=this.attachment(ws);if(player){this.broadcast({v:1,type:'leave',playerId:player.id},ws);this.telemetry.event('leave',{playerId:player.id,slot:player.slot,code:1011,wasClean:false,connectedCount:Math.max(0,this.ctx.getWebSockets().length-1)});}try{ws.close(1011,'WebSocket error');}catch(closeError){this.telemetry.exception('webSocketError.close',closeError,this.ctx.getWebSockets().length);}}catch(handlerError){this.telemetry.exception('webSocketError.handler',handlerError,this.ctx.getWebSockets().length);}}
    async alarm():Promise<void>{
        try{const logic=this.logic();if(!logic.roundEnded)return;const reset=logic.reset();this.sync(logic);this.broadcast({v:1,type:'round_reset',round:reset.round});this.telemetry.event('round_reset',{round:reset.round,connectedCount:logic.players.size});this.telemetry.flushIfDue(logic.players.size);}catch(error){this.telemetry.exception('alarm',error,this.ctx.getWebSockets().length);throw error;}
    }
    private attachment(ws:WebSocket){const value=ws.deserializeAttachment();return value&&typeof value==='object'?value as Attachment:null;}
    private connectedCount(except?:WebSocket){let count=0;for(const socket of this.ctx.getWebSockets())if(socket!==except&&socket.readyState===WebSocket.OPEN)count++;return count;}
    private logic(){
        const attachments=this.ctx.getWebSockets().map(ws=>this.attachment(ws)).filter((value):value is Attachment=>value!==null);
        const round=Math.max(1,...attachments.map(player=>player.round));const roundEnded=attachments.some(player=>player.roundEnded);
        return new RoomLogic(round,roundEnded,attachments.map(({id,name,slot,kills})=>({id,name,slot,kills})));
    }
    private sync(logic:RoomLogic){for(const ws of this.ctx.getWebSockets()){const attachment=this.attachment(ws),player=attachment&&logic.players.get(attachment.id);if(player)ws.serializeAttachment({...player,round:logic.round,roundEnded:logic.roundEnded} satisfies Attachment);}}
    private send(socket:WebSocket,message:ServerMessage){const encoded=JSON.stringify(message);socket.send(encoded);this.telemetry.recordOutbound(message.type,utf8MessageBytes(encoded));}
    private broadcast(message:ServerMessage,except?:WebSocket){const encoded=JSON.stringify(message),bytes=utf8MessageBytes(encoded);let recipients=0;for(const socket of this.ctx.getWebSockets())if(socket!==except&&socket.readyState===WebSocket.OPEN)try{socket.send(encoded);recipients++;}catch(error){this.telemetry.exception('broadcast.send',error,this.connectedCount());}this.telemetry.recordOutbound(message.type,bytes,recipients,true);}
}
