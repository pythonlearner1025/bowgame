type Counter={count:number;bytes:number};
type StructuredLog=(entry:Record<string,unknown>,error?:boolean)=>void;

export function utf8MessageBytes(value:string){
    let bytes=0;
    for(let i=0;i<value.length;i++){
        const code=value.charCodeAt(i);
        if(code<0x80)bytes++;
        else if(code<0x800)bytes+=2;
        else if(code>=0xd800&&code<=0xdbff&&i+1<value.length&&value.charCodeAt(i+1)>=0xdc00&&value.charCodeAt(i+1)<=0xdfff){bytes+=4;i++;}
        else bytes+=3;
    }
    return bytes;
}

/** In-memory rolling metrics for an active room; hibernation starts a new window. */
export class RoomTelemetry {
    private startedAt:number;private inbound:Record<string,Counter>=Object.create(null);private outbound:Record<string,Counter>=Object.create(null);private broadcastFanOut=0;private maxMessageBytes=0;
    constructor(private readonly write:StructuredLog,now=Date.now()){this.startedAt=now;}
    event(event:string,fields:Record<string,unknown>={}){this.write({service:'bow_room',event,timestamp:new Date().toISOString(),...fields});}
    exception(handler:string,error:unknown,connectedCount:number){this.write({service:'bow_room',event:'exception',timestamp:new Date().toISOString(),handler,errorName:error instanceof Error?error.name:'UnknownError',errorMessage:error instanceof Error?error.message:String(error),connectedCount},true);}
    recordInbound(type:string,bytes:number){this.bump(this.inbound,type,bytes,1);this.maxMessageBytes=Math.max(this.maxMessageBytes,bytes);}
    recordOutbound(type:string,bytes:number,recipients=1,broadcast=false){this.bump(this.outbound,type,bytes,recipients);if(broadcast)this.broadcastFanOut+=recipients;this.maxMessageBytes=Math.max(this.maxMessageBytes,bytes);}
    flushIfDue(connectedCount:number,now=Date.now(),force=false){
        const windowMs=now-this.startedAt;if(!force&&windowMs<60_000)return null;
        const summary={service:'bow_room',event:'summary',timestamp:new Date(now).toISOString(),windowStartedAt:new Date(this.startedAt).toISOString(),windowMs,inboundMessagesByType:this.inbound,outboundMessagesByType:this.outbound,broadcastFanOut:this.broadcastFanOut,maxMessageBytes:this.maxMessageBytes,connectedCount};
        this.write(summary);this.startedAt=now;this.inbound=Object.create(null);this.outbound=Object.create(null);this.broadcastFanOut=0;this.maxMessageBytes=0;return summary;
    }
    private bump(target:Record<string,Counter>,type:string,bytes:number,count:number){const entry=target[type]??={count:0,bytes:0};entry.count+=count;entry.bytes+=bytes*count;}
}
