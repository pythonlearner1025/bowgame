import {BOW_ROOM_CAP,BOW_SCORE_LIMIT} from '../src/BowProtocol.js';

export const ROOM_CAP=BOW_ROOM_CAP;
export const SCORE_LIMIT=BOW_SCORE_LIMIT;

export interface RoomPlayer {id:string;name:string;slot:number;kills:number}
export interface DeathResult {accepted:boolean;scores:Record<string,number>;winnerId:string|null}

/** Pure round/cap state machine shared by the Durable Object and Node tests. */
export class RoomLogic {
    readonly players=new Map<string,RoomPlayer>();
    constructor(public round=1,public roundEnded=false,players:RoomPlayer[]=[]){for(const player of players)this.players.set(player.id,{...player});}
    join(id:string,name:string){
        const existing=this.players.get(id);if(existing){existing.name=name;return existing;}
        if(this.players.size>=ROOM_CAP)return null;
        const used=new Set([...this.players.values()].map(player=>player.slot));let slot=0;while(used.has(slot))slot++;
        const player={id,name,slot,kills:0};this.players.set(id,player);return player;
    }
    leave(id:string){return this.players.delete(id);}
    scores(){return Object.fromEntries([...this.players.values()].map(player=>[player.id,player.kills]));}
    death(_deadId:string,killerId:string):DeathResult{
        if(this.roundEnded)return {accepted:false,scores:this.scores(),winnerId:null};
        const killer=this.players.get(killerId);if(!killer)return {accepted:false,scores:this.scores(),winnerId:null};
        killer.kills++;
        const winnerId=killer.kills>=SCORE_LIMIT?killer.id:null;if(winnerId)this.roundEnded=true;
        return {accepted:true,scores:this.scores(),winnerId};
    }
    reset(){this.round++;this.roundEnded=false;for(const player of this.players.values())player.kills=0;return {round:this.round,scores:this.scores()};}
}
