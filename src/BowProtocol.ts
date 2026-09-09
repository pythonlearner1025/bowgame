export const BOW_PROTOCOL_VERSION=1 as const;

export interface NetVector3 {x:number;y:number;z:number}
export type PlayerAnim='ready'|'walk'|'draw'|'release'|'dead';
export interface RosterPlayer {id:string;name:string;slot:number}
export type ScoreMap=Record<string,number>;

export type ClientMessage=
    |{v:1;type:'join';name:string}
    |{v:1;type:'state';seq:number;pos:NetVector3;yaw:number;pitch:number;draw:number;anim:PlayerAnim}
    |{v:1;type:'shot';arrowId:string;origin:NetVector3;velocity:NetVector3}
    |{v:1;type:'hit';targetId:string;arrowId:string;damage:number;head:boolean}
    |{v:1;type:'death';killerId:string}
    |{v:1;type:'ping';sentAt:number};

export type ServerMessage=
    |{v:1;type:'welcome';playerId:string;roster:RosterPlayer[];scores:ScoreMap;scoreLimit:number;round:number}
    |{v:1;type:'join';playerId:string;name:string;slot:number}
    |{v:1;type:'state';playerId:string;seq:number;pos:NetVector3;yaw:number;pitch:number;draw:number;anim:PlayerAnim}
    |{v:1;type:'shot';playerId:string;arrowId:string;origin:NetVector3;velocity:NetVector3}
    |{v:1;type:'hit';playerId:string;targetId:string;arrowId:string;damage:number;head:boolean}
    |{v:1;type:'death';playerId:string;killerId:string}
    |{v:1;type:'scores';scores:ScoreMap}
    |{v:1;type:'round_end';winnerId:string;scores:ScoreMap}
    |{v:1;type:'round_reset';round:number}
    |{v:1;type:'leave';playerId:string}
    |{v:1;type:'full'}
    |{v:1;type:'pong';sentAt:number};

const object=(value:unknown):value is Record<string,unknown>=>typeof value==='object'&&value!==null&&!Array.isArray(value);
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);
const vector=(value:unknown):value is NetVector3=>object(value)&&finite(value.x)&&finite(value.y)&&finite(value.z);
const id=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=80;
const anim=(value:unknown):value is PlayerAnim=>typeof value==='string'&&['ready','walk','draw','release','dead'].includes(value);

export function cleanPlayerName(value:unknown){
    const name=typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,24):'';
    return name||'Archer';
}

export function parseClientMessage(raw:unknown):ClientMessage|null{
    if(!object(raw)||raw.v!==BOW_PROTOCOL_VERSION||typeof raw.type!=='string')return null;
    switch(raw.type){
        case'join':return typeof raw.name==='string'?{v:1,type:'join',name:cleanPlayerName(raw.name)}:null;
        case'state':return Number.isSafeInteger(raw.seq)&&finite(raw.seq)&&raw.seq>=0&&vector(raw.pos)&&finite(raw.yaw)&&finite(raw.pitch)&&finite(raw.draw)&&raw.draw>=0&&raw.draw<=1&&anim(raw.anim)?{v:1,type:'state',seq:raw.seq,pos:raw.pos,yaw:raw.yaw,pitch:raw.pitch,draw:raw.draw,anim:raw.anim}:null;
        case'shot':return id(raw.arrowId)&&vector(raw.origin)&&vector(raw.velocity)?{v:1,type:'shot',arrowId:raw.arrowId,origin:raw.origin,velocity:raw.velocity}:null;
        case'hit':return id(raw.targetId)&&id(raw.arrowId)&&finite(raw.damage)&&raw.damage>0&&raw.damage<=200&&typeof raw.head==='boolean'?{v:1,type:'hit',targetId:raw.targetId,arrowId:raw.arrowId,damage:Math.round(raw.damage),head:raw.head}:null;
        case'death':return id(raw.killerId)?{v:1,type:'death',killerId:raw.killerId}:null;
        case'ping':return finite(raw.sentAt)?{v:1,type:'ping',sentAt:raw.sentAt}:null;
        default:return null;
    }
}

export function parseServerMessage(raw:unknown):ServerMessage|null{
    if(!object(raw)||raw.v!==BOW_PROTOCOL_VERSION||typeof raw.type!=='string')return null;
    // Server messages are produced by the same Worker bundle. This guard rejects
    // unknown versions/types before the session consumes their typed payloads.
    return ['welcome','join','state','shot','hit','death','scores','round_end','round_reset','leave','full','pong'].includes(raw.type)?raw as ServerMessage:null;
}
