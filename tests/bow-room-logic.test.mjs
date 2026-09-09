import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';

const bundled=await build({entryPoints:['worker/roomLogic.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const source=`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`;
const {RoomLogic,ROOM_CAP,SCORE_LIMIT}=await import(source);

test('room caps membership at ten and reuses a departed player slot',()=>{
  const room=new RoomLogic();
  for(let i=0;i<ROOM_CAP;i++)assert.equal(room.join(`p${i}`,`Archer-${i}`)?.slot,i);
  assert.equal(room.join('overflow','Archer-X'),null);
  assert.equal(room.leave('p4'),true);assert.equal(room.players.size,9);
  assert.equal(room.join('replacement','Archer-R')?.slot,4);assert.equal(room.players.size,10);
});

test('death is the only event that tallies a valid killer',()=>{
  const room=new RoomLogic(),a=room.join('a','A'),b=room.join('b','B');assert.ok(a&&b);
  assert.equal(room.scores().a,0);assert.equal(room.death('b','missing').accepted,false);
  const result=room.death('b','a');assert.equal(result.accepted,true);assert.equal(result.scores.a,1);assert.equal(result.winnerId,null);
});

test('twenty deaths end a round and further deaths do not score',()=>{
  const room=new RoomLogic();room.join('a','A');room.join('b','B');let result;
  for(let i=0;i<SCORE_LIMIT;i++)result=room.death('b','a');
  assert.equal(result.winnerId,'a');assert.equal(room.roundEnded,true);assert.equal(room.scores().a,20);
  assert.equal(room.death('b','a').accepted,false);assert.equal(room.scores().a,20);
});

test('reset advances the round, clears kills, and permits play again',()=>{
  const room=new RoomLogic(7);room.join('a','A');room.join('b','B');for(let i=0;i<SCORE_LIMIT;i++)room.death('b','a');
  const reset=room.reset();assert.equal(reset.round,8);assert.deepEqual(reset.scores,{a:0,b:0});assert.equal(room.roundEnded,false);
  assert.equal(room.death('a','b').scores.b,1);
});

test('leave removes a player and their score',()=>{
  const room=new RoomLogic();room.join('a','A');room.join('b','B');room.death('b','a');
  assert.equal(room.leave('a'),true);assert.deepEqual(room.scores(),{b:0});assert.equal(room.leave('a'),false);
});
