import type {ClientMessage,ServerMessage} from './BowProtocol.js';
import {utf8ByteLength,type BowTelemetrySink} from './BowPerformance.js';

export type TransportEvent=
    |{kind:'message';message:ServerMessage}
    |{kind:'status';status:'connected'|'disconnected';reason?:string};
export type TransportHandler=(event:TransportEvent)=>void;

/** Backend-neutral multiplayer seam. */
export interface Transport {
    connect():Promise<void>;
    send(message:ClientMessage):boolean;
    onMessage(handler:TransportHandler):()=>void;
    close():void;
}

export class WebSocketTransport implements Transport {
    private socket:WebSocket|null=null;
    private handlers=new Set<TransportHandler>();
    private manuallyClosed=false;
    constructor(private readonly url:string,private readonly telemetry:BowTelemetrySink|null=null){}

    connect(){
        this.manuallyClosed=false;
        if(this.socket?.readyState===WebSocket.OPEN)return Promise.resolve();
        this.socket?.close();
        return new Promise<void>((resolve,reject)=>{
            const socket=new WebSocket(this.url);this.socket=socket;let opened=false;
            socket.addEventListener('open',()=>{if(this.socket!==socket)return;opened=true;this.emit({kind:'status',status:'connected'});resolve();},{once:true});
            socket.addEventListener('message',event=>{
                if(typeof event.data!=='string')return;
                try{const message=JSON.parse(event.data) as ServerMessage;this.telemetry?.recordNetwork('inbound',message.type??'invalid',utf8ByteLength(event.data));this.emit({kind:'message',message});}catch{}
            });
            socket.addEventListener('close',event=>{
                if(this.socket===socket)this.socket=null;
                this.telemetry?.recordSocketClose(event.code,event.wasClean);
                if(!opened)reject(new Error(`WebSocket rejected (${event.code||'network'})`));
                if(!this.manuallyClosed)this.emit({kind:'status',status:'disconnected',reason:event.reason||undefined});
            });
            socket.addEventListener('error',()=>{if(!opened)reject(new Error('WebSocket connection failed'));},{once:true});
        });
    }
    send(message:ClientMessage){if(this.socket?.readyState!==WebSocket.OPEN)return false;const encoded=JSON.stringify(message);this.socket.send(encoded);this.telemetry?.recordNetwork('outbound',message.type,utf8ByteLength(encoded));return true;}
    onMessage(handler:TransportHandler){this.handlers.add(handler);return()=>this.handlers.delete(handler);}
    close(){this.manuallyClosed=true;this.socket?.close(1000,'Client closed');this.socket=null;}
    private emit(event:TransportEvent){for(const handler of this.handlers)handler(event);}
}
