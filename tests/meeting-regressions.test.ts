import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { WebSocket } from "ws";
import * as THREE from "three";
import { attachMeetingRelay } from "../scripts/meeting/relay.ts";
import { createMeetingRoom, addMeetingMember, publishMeeting, meetingView, meetingWorld, moveMeeting, meetingVisibleMembers,
  MEETING_SIZE, connectionCells, advanceMeetingTurns, meetingTurn, TURN_DURATION, type MeetingMessage } from "../lib/meeting.ts";
import { createMeetingCodec } from "../lib/meeting-wire.ts";
import { floorHeight } from "../lib/terrain.ts";
import { deriveEnvironment } from "../lib/environment.ts";
import { makeGround, createTerrainCache } from "../components/whistle/TerrainGround.ts";
import { disposeTerrain } from "./terrain-fixtures.ts";

const move=(room:ReturnType<typeof createMeetingRoom>,id:string,x:number,z:number)=>moveMeeting(room,id,{x,z,yaw:0,grounded:true},true);
const setup=()=>{const room=createMeetingRoom(13);for(const id of ["a","b","c"])addMeetingMember(room,id);return room;};
const finishTurn=(room:ReturnType<typeof createMeetingRoom>,id:string)=>{const turn=meetingTurn(room,id)!;advanceMeetingTurns(room,turn.endsAt+(turn.owner===id?0:TURN_DURATION));};

test("four players open only their paired worlds and every crossing has continuous support",()=>{
  const room=setup();addMeetingMember(room,"d");
  for(const id of room.chain) {
    const world=structuredClone(room.members.get(id)!.document);
    world.terrain!.tiles.forEach(tile=>{delete tile.void;delete tile.hole;tile.height=0;tile.surface="plain";});
    world.assets.push({...world.assets[0],id:`original-${id}`,text:id});
    world.objects.push({id:`placed-${id}`,asset:`original-${id}`,x:6,z:10,rotation:0,scale:1});publishMeeting(room,id,world,[],true);
  }
  for(const id of room.chain)finishTurn(room,id);
  for(const id of room.chain) {
    const world=structuredClone(room.members.get(id)!.document),gifts=[...room.members.get(id)!.materials.values()];
    world.assets.push(...gifts);world.objects=gifts.map((a,i)=>({id:`use-${i}`,asset:a.id,x:6,z:10,rotation:0,scale:1}));
    publishMeeting(room,id,world,gifts.map(a=>a.id));
    for(const gate of meetingView(room,id).connections)move(room,id,gate.x,gate.z);
  }
  assert.equal(room.connections.length,4);assert.equal(room.links.length,4);
  for(const id of room.chain) {
    const view=meetingView(room,id);assert.ok(view.joined.length<=3);
    for(const gate of view.connections) for(let i=-10;i<=10;i++)
      assert.notEqual(floorHeight(view.world,gate.x+i/10,gate.z,[]),null);
  }
  assert.deepEqual(meetingView(room,"a").joined,["a","b"]);
  assert.deepEqual(meetingView(room,"b").joined,["b","a"]);
  assert.deepEqual(meetingView(room,"c").joined,["c","d"]);
});

test("more than twenty received materials remain editable, excess delivery waits and resumes after deletion",()=>{
  const room=setup(),base=structuredClone(room.members.get("a")!.document);
  let recipient=structuredClone(room.members.get("b")!.document);
  publishMeeting(room,"a",base);publishMeeting(room,"b",recipient);
  const received:string[]=[];
  for(let i=0;i<260;i++) {
    const own=structuredClone(base);own.assets.push({...base.assets[0],id:`original-${i}`,text:`gift ${i}`});
    own.objects.push({id:`placed-${i}`,asset:`original-${i}`,x:6,z:10,rotation:0,scale:1});
    publishMeeting(room,"a",own,[],true);
    finishTurn(room,"a");
    const view=meetingView(room,"b");
    const fresh=view.materials.filter(a=>!received.includes(a.id));
    received.push(...fresh.map(a=>a.id));recipient.assets.push(...fresh);
    publishMeeting(room,"b",recipient,received);
  }
  assert.equal(recipient.assets.length,250);
  let view=meetingView(room,"b");assert.ok(view.pendingMaterials>0);
  const pending=view.pendingMaterials;
  const deleted=recipient.assets.find(a=>received.includes(a.id))!.id;
  recipient.assets=recipient.assets.filter(a=>a.id!==deleted);
  recipient.assets.find(a=>received.includes(a.id))!.text="edited locally";
  publishMeeting(room,"b",recipient,received);
  view=meetingView(room,"b");assert.equal(view.pendingMaterials,pending-1);
  const next=view.materials.filter(a=>!received.includes(a.id));assert.equal(next.length,1);
  assert.notEqual(next[0].id,deleted);
  recipient.assets.push(next[0]);received.push(next[0].id);publishMeeting(room,"b",recipient,received);
  assert.equal(meetingView(room,"b").pendingMaterials,pending-1);
  assert.ok(!meetingView(room,"b").ownWorld.assets.some(a=>a.id===deleted));
});

test("chunked terrain keeps water, hole and border geometry after edits and reuses unaffected chunks",()=>{
  const room=setup();room.links.push(["a","b"],["a","c"]);
  const world=structuredClone(meetingWorld(room,"a"));
  for(let z=0;z<12;z++)for(let x=0;x<MEETING_SIZE;x++)world.terrain!.tiles[z*MEETING_SIZE+x]={height:x>8&&x<16?1:0,surface:x<6?"soft":"plain"};
  for(let z=4;z<8;z++)for(let x=3;x<6;x++)world.terrain!.tiles[z*MEETING_SIZE+x].surface="slick";
  world.terrain!.tiles[5*MEETING_SIZE+9].hole=true;
  const cache=createTerrainCache();
  for(let round=0;round<3;round++) {
    if(round)world.terrain!.tiles[6*MEETING_SIZE+14].height=round;
    const before=new Map(cache),env=deriveEnvironment(world,[]);
    const actual=makeGround(world,env,cache),expected=makeGround(world,env);
    if(round)assert.ok([...cache].filter(([id,v])=>before.get(id)===v).length>30);
    const mesh=actual.group.getObjectByName("continuous-ground") as THREE.Mesh;
    const original=expected.group.getObjectByName("continuous-ground") as THREE.Mesh;
    const ray=new THREE.Raycaster();
    for(const [x,z] of [[2,5],[6,5],[10,5],[14,6],[18,7],[22,10],[9,5],[12,12],[11.5,4.5],[5.99,5.2],[6.01,5.2]]) {
      ray.set(new THREE.Vector3(x*2-(MEETING_SIZE-1),20,z*2-(MEETING_SIZE-1)),new THREE.Vector3(0,-1,0));
      const a=ray.intersectObject(mesh)[0],b=ray.intersectObject(original)[0];
      assert.equal(!!a,!!b,`coverage at ${x},${z}`);
      if(a&&b){assert.ok(Math.abs(a.point.y-b.point.y)<.00001,`height at ${x},${z}`);assert.ok(a.normal!.distanceTo(b.normal!)<.001,`normal at ${x},${z}`);}
    }
    disposeTerrain(actual.group);disposeTerrain(expected.group);
  }
});

test("relay reclaims overlapping sessions and forgets worlds after idle eviction and restart",async t=>{
  let now=Date.now();t.mock.method(Date,"now",()=>now);
  const clients:WebSocket[]=[];
  const start=async()=>{
    const server=createServer(),relay=attachMeetingRelay(server,{cleanupMs:10});
    server.listen(0,"127.0.0.1");await once(server,"listening");
    return {port:(server.address() as {port:number}).port,async close(){clients.forEach(c=>c.terminate());await relay.close();await new Promise<void>(r=>server.close(()=>r()));}};
  };
  let running=await start();
  t.after(async()=>{await running.close();});
  const connect=async(id:string)=>{
    const ws=new WebSocket(`ws://127.0.0.1:${running.port}/whistle/meeting?room=persistent&id=${id}&token=${id}-private-resume-token`);clients.push(ws);
    const codec=createMeetingCodec(),messages:MeetingMessage[]=[];
    ws.on("message",data=>{const message=codec.decode<MeetingMessage>(data.toString());if(message)messages.push(message);});
    const wait=async(predicate:(message:MeetingMessage)=>boolean)=>{
      for(let i=0;i<400;i++){const index=messages.findIndex(predicate);if(index>=0)return messages.splice(index,1)[0];await new Promise(r=>setTimeout(r,5));}throw Error("Missing relay state");
    };
    const send=(message:object)=>{for(const frame of codec.encode(message))ws.send(frame);};
    await once(ws,"open");let initial=await wait(m=>m.type==="state");assert.equal(initial.type,"state");
    if(!initial.view.documentReady){send({type:"publish",world:initial.view.ownWorld});initial=await wait(m=>m.type==="state"&&m.view.documentReady);assert.equal(initial.type,"state");}
    return {ws,wait,initial,send};
  };
  const a=await connect("aaaaaaaa"),b=await connect("bbbbbbbb");await connect("cccccccc");
  const own=structuredClone(a.initial.view.ownWorld);own.assets.push({...own.assets[0],id:"saved",text:"persistent gift"});
  own.terrain!.tiles[9*12+6]={height:1,surface:"plain"};
  own.objects.push({id:"placed",asset:"saved",x:6,z:10,rotation:0,scale:1});
  a.send({type:"publish",world:own,share:true});
  await a.wait(m=>m.type==="state"&&m.view.ownWorld.assets.some(a=>a.id==="saved"));
  now+=TURN_DURATION;
  const gift=await b.wait(m=>m.type==="state"&&m.view.materials.length===1);assert.equal(gift.type,"state");
  const recipient=structuredClone(gift.view.ownWorld);recipient.assets.push({...gift.view.materials[0],text:"recipient edit"});
  b.send({type:"publish",world:recipient,received:[gift.view.materials[0].id]});
  await b.wait(m=>m.type==="state"&&m.view.received.length===1);
  const intruder=new WebSocket(`ws://127.0.0.1:${running.port}/whistle/meeting?room=persistent&id=bbbbbbbb&token=incorrect-session-token`);
  const rejected=once(intruder,"close");await once(intruder,"open");
  assert.equal((await rejected)[0],1008);assert.equal(b.ws.readyState,WebSocket.OPEN);
  const previousClosed=once(b.ws,"close");const replacement=await connect("bbbbbbbb");
  assert.equal((await previousClosed)[0],4001);
  assert.equal(replacement.initial.view.id,"bbbbbbbb");assert.equal(replacement.initial.presence.peers.length,3);
  assert.ok(replacement.initial.presence.peers.find(p=>p.id==="bbbbbbbb")!.online);
  clients.forEach(c=>c.close());await new Promise(r=>setTimeout(r,80));
  const evicted=await connect("aaaaaaaa");assert.notDeepEqual(evicted.initial.view.ownWorld,own);
  await running.close();running=await start();
  const restarted=await connect("bbbbbbbb");
  assert.notDeepEqual(restarted.initial.view.ownWorld,recipient);
  assert.equal(restarted.initial.view.received.length,0);
  restarted.send({type:"publish",world:recipient});
  const recovered=await restarted.wait(m=>m.type==="state"&&m.view.ownWorld.assets.some(a=>a.text==="recipient edit"));
  assert.equal(recovered.type,"state");
  assert.deepEqual({...recovered.view.ownWorld,connectionFootings:[]},{...recipient,connectionFootings:[]});
  assert.deepEqual(recovered.view.ownWorld.connectionFootings??[],[]);
  const next=await connect("dddddddd");assert.equal(next.initial.view.materials.length,0);
  assert.equal(restarted.initial.view.slot,0);
});


test("a gift arriving during a local edit cannot overflow the library or replace an edited gift",async()=>{
  const {mergeReceivedAssets}=await import("../lib/content-limits.ts");
  const world=setup().members.get("a")!.document;
  world.assets=Array.from({length:249},(_,i)=>({...world.assets[0],id:`existing-${i}`}));
  const gifts=[{...world.assets[0],id:"new-a",text:"first"},{...world.assets[0],id:"new-b",text:"second"}];
  const first=mergeReceivedAssets(world,gifts);
  assert.equal(first.world.assets.length,250);assert.deepEqual(first.accepted,[gifts[0]]);
  assert.equal(mergeReceivedAssets(first.world,[gifts[1]]).accepted.length,0);
  first.world.assets[first.world.assets.length-1]={...first.world.assets.at(-1)!,text:"edited"};
  const duplicate=mergeReceivedAssets(first.world,gifts);
  assert.deepEqual(duplicate.accepted,[gifts[0]]);assert.equal(duplicate.world.assets.at(-1)!.text,"edited");
  const freed={...first.world,assets:first.world.assets.slice(1)};
  const delivered=mergeReceivedAssets(freed,[gifts[1]]);
  assert.equal(delivered.world.assets.length,250);assert.deepEqual(delivered.accepted,[gifts[1]]);
  assert.equal(world.assets.length,249);assert.equal(gifts[0].text,"first");
});
