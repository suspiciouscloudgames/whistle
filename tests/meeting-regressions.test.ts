import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { WebSocket } from "ws";
import * as THREE from "three";
import { attachMeetingRelay } from "../scripts/meeting/relay.ts";
import { createMeetingRoom, addMeetingMember, publishMeeting, meetingView, meetingWorld, moveMeeting, meetingVisibleMembers,
  MEETING_SIZE, connectionCells, advanceMeetingTurns, meetingTurn, TURN_DURATION, type MeetingMessage, type MeetingPresence } from "../lib/meeting.ts";
import { MeetingTrail, TRAIL_CAPACITY, TRAIL_LENGTH_TILES, TRAIL_LIFETIME_MS } from "../lib/meeting-trail.ts";
import { createPeerTrailLine } from "../components/whistle/PeerTrailLine.ts";
import { createWorldDeriver } from "../lib/world-derivation.ts";
import { createMeetingCodec } from "../lib/meeting-wire.ts";
import { floorHeight } from "../lib/terrain.ts";
import { deriveEnvironment } from "../lib/environment.ts";
import { makeGround, createTerrainCache } from "../components/whistle/TerrainGround.ts";
import { disposeTerrain, terrainFixtures } from "./terrain-fixtures.ts";

const move=(room:ReturnType<typeof createMeetingRoom>,id:string,x:number,z:number)=>moveMeeting(room,id,{x,z,yaw:0,grounded:true},true);
const setup=()=>{const room=createMeetingRoom(13);for(const id of ["a","b","c"])addMeetingMember(room,id);return room;};
const finishTurn=(room:ReturnType<typeof createMeetingRoom>,id:string)=>{const turn=meetingTurn(room,id)!;advanceMeetingTurns(room,turn.endsAt+(turn.owner===id?0:TURN_DURATION));};

function trailPlayers() {
  const peer = {id:"guest",slot:0,online:true,playing:true,player:{x:4,z:5,yaw:0,grounded:true}};
  const self = {...peer,id:"host",player:{...peer.player}};
  const presence: MeetingPresence = {peers:[self,peer],canWhistle:true};
  const trail = new MeetingTrail();
  const sample = (time:number) => trail.receive(presence, self.id, peer.id, time);
  return {peer, self, presence, trail, sample};
}

test("peer trails require shared play and never join across a warp, an unsupported position or a reconnect", () => {
  const {peer,self,presence,trail,sample} = trailPlayers();
  presence.canWhistle = false;
  sample(0);
  assert.equal(trail.points.length, 0);
  presence.canWhistle = true;
  presence.turn = {owner:self.id,partner:peer.id,startedAt:0,endsAt:60_000,serverNow:5};
  sample(5);
  assert.equal(trail.points.length, 0);
  delete presence.turn;
  sample(10);
  peer.player.x += .2;
  sample(100);
  const head = trail.points.at(-1)!;
  self.player.x += .5;
  peer.player.yaw += 1;
  sample(400);
  assert.equal(trail.points.at(-1), head);
  assert.equal(head.time, 100);
  peer.player.x += 5;
  sample(480);
  assert.deepEqual(trail.points.map(p=>p.x), [peer.player.x]);
  peer.online = false; sample(500);
  peer.online = true; peer.player.x += .15; sample(510);
  assert.deepEqual(trail.points.map(p=>p.distance), [0]);
  peer.playing = false; sample(520);
  assert.equal(trail.points.length, 0);
  peer.playing = true; sample(540);
  peer.player.x += .15; sample(570);
  const takeoff = trail.points.at(-1);
  peer.player.grounded = false; peer.player.x += .1; sample(600);
  assert.equal(trail.points.at(-1), takeoff);
  peer.player.grounded = true; sample(680);
  assert.deepEqual(trail.points.map(p=>p.time), [680]);
  trail.receive(presence,self.id,undefined,700);
  assert.equal(trail.points.length, 0);
  sample(720); peer.player.z += .2; sample(2500);
  assert.deepEqual(trail.points.map(p=>p.time), [2500]);
  self.playing = false; sample(2510);
  assert.equal(trail.points.length, 0);
});

test("trail length follows bends, stays above the floor and fades on the same GPU buffers", () => {
  const {peer,trail,sample} = trailPlayers();
  const world = terrainFixtures().flat;
  world.terrain!.floating = true;
  for (const tile of world.terrain!.tiles) tile.height = 2;
  const derive = createWorldDeriver(), ground = derive(world);
  const {line,update} = createPeerTrailLine();
  const position = line.geometry.getAttribute("position") as THREE.BufferAttribute;
  sample(0);
  for (let i=1; i<=20; i++) {
    peer.player.x += i%4 < 2 ? .18 : -.18;
    sample(i*80);
  }
  const head = trail.points.at(-1)!;
  const distance = head.distance - trail.points[0].distance;
  assert.ok(distance > 1.5 && distance <= TRAIL_LENGTH_TILES);
  update(trail,world,ground,head.time);
  assert.equal(line.visible,true);
  assert.equal(line.castShadow || line.receiveShadow || line.material.lights,false);
  assert.equal(line.material.depthTest,true);
  assert.equal(line.geometry.drawRange.count,trail.points.length);
  assert.equal(line.material.uniforms.lemon.value.getHexString(),"f3ef91");
  const last = line.geometry.drawRange.count-1, taper = line.geometry.getAttribute("taper");
  const floor = floorHeight(world,head.x,head.z,ground.structures)!;
  assert.ok(Math.abs(position.getY(last) - floor - .18) < .001);
  assert.ok(taper.getX(0) > taper.getX(last) && taper.getY(0) > taper.getY(last));
  const version = position.version;
  update(trail,world,ground,head.time+750);
  assert.equal(line.material.uniforms.elapsed.value,.5);
  assert.equal(position.version,version);
  update(trail,world,ground,head.time+TRAIL_LIFETIME_MS);
  assert.equal(line.visible,false);
  assert.equal(line.geometry.drawRange.count,0);
  for (let i=1; i<=100; i++) {
    peer.player.z += .01;
    sample(head.time+TRAIL_LIFETIME_MS+i*5);
  }
  assert.equal(trail.points.length,TRAIL_CAPACITY);
  update(trail,world,ground,trail.points.at(-1)!.time);
  assert.equal(line.geometry.getAttribute("position"),position);
  const changed = structuredClone(world);
  changed.terrain!.tiles.forEach(tile=>{tile.void=true;});
  update(trail,changed,derive(changed),trail.points.at(-1)!.time);
  assert.equal(line.visible,false);
  line.geometry.dispose(); line.material.dispose();
});

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
  now+=60_001;await new Promise(r=>setTimeout(r,30));
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


test("ten simultaneous workshop connections keep five pairs through toggles and a room-wide outage", async t => {
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const server = createServer(), relay = attachMeetingRelay(server, {cleanupMs: 10});
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as {port:number}).port;
  const sockets: WebSocket[] = [];
  t.after(async () => {
    sockets.forEach(socket => socket.terminate());
    await relay.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  const until = async (predicate: () => boolean) => {
    for (let i=0; i<500; i++) {
      if (predicate()) return;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.fail("Workshop state did not converge");
  };
  const connect = async (id: string) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/whistle/meeting?room=workshop&id=${id}&token=${id}-private-session`);
    sockets.push(socket);
    const codec = createMeetingCodec();
    const client = {id, socket, states:0, partner:"", owner:"", end:0, count:0, title:"", ready:false,
      publish: (world: ReturnType<typeof meetingWorld>) => {
        for (const frame of codec.encode({type:"publish",world})) socket.send(frame);
      }};
    let published = false;
    socket.on("message", data => {
      const message = codec.decode<MeetingMessage>(data.toString());
      if (message?.type !== "state" && message?.type !== "presence") return;
      client.count = message.presence.onlineCount!;
      client.owner = message.presence.turn?.owner ?? "";
      client.end = message.presence.turn?.endsAt ?? 0;
      if (message.type === "state") {
        client.states++;
        client.partner = message.view.recipients[0] ?? "";
        client.title = message.view.ownWorld.title;
        client.ready = message.view.documentReady;
        if (!published) {
          published = true;
          client.publish({...message.view.ownWorld, title:id});
        }
      }
    });
    await once(socket, "open");
    return client;
  };
  const ids = Array.from({length:10}, (_,i) => `player-0${i}`);
  let clients = await Promise.all(ids.map(connect));
  const paired = () => clients.every(c => c.ready && c.count === 10 && clients.some(p => p.id === c.partner && p.partner === c.id && p !== c));
  await until(paired);
  const original = new Map(clients.map(c => [c.id,{partner:c.partner, owner:c.owner, end:c.end}]));
  assert.equal(new Set(clients.map(c=>[c.id,c.partner].sort().join("/"))).size,5);
  const released = clients[0], other = clients.find(c=>c.id!==released.id && c.partner!==released.id)!;
  const survivor = clients.find(c=>c.id===released.partner)!;
  const otherStates = other.states;
  now += 5000;
  released.socket.terminate();
  await until(()=>survivor.count===9 && survivor.partner==="");
  const visitor = await connect("late-visitor");
  await until(()=>visitor.ready && survivor.count===10);
  assert.equal(visitor.partner,"");
  now += 7000;
  clients[0] = await connect(released.id);
  await until(()=>clients[0].ready && clients[0].partner===survivor.id && survivor.count===11);
  assert.equal(survivor.owner,original.get(survivor.id)!.owner);
  assert.equal(survivor.end,original.get(survivor.id)!.end+7000);
  assert.equal(other.end,original.get(other.id)!.end);
  assert.equal(other.states,otherStates);
  visitor.socket.terminate();
  await until(paired);
  await Promise.all(clients.map(async c => {const closed=once(c.socket,"close");c.socket.terminate();await closed;}));
  now += 3000;
  clients = await Promise.all([...ids].reverse().map(connect));
  await until(paired);
  for (const c of clients) {
    assert.equal(c.title,c.id);
    assert.equal(c.partner,original.get(c.id)!.partner);
    assert.equal(c.owner,original.get(c.id)!.owner);
  }
  now += TURN_DURATION;
  await until(()=>clients.every(c=>c.owner!==original.get(c.id)!.owner));
  assert.ok(paired());
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

test("reconnecting a world with more than 120 media frames restores every received material", async t => {
  const server = createServer(), relay = attachMeetingRelay(server);
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const clients: WebSocket[] = [];
  t.after(async () => {
    clients.forEach(client => client.terminate()); await relay.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  const room = createMeetingRoom(15), member = addMeetingMember(room, "aaaaaaaa"), world = structuredClone(member.document);
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
  for (let i = 0; i < 130; i++) world.assets.push({ id: `received-${i}`, name: "받은 이미지", shape: "sphere", color: "#111111", solid: false, received: true,
    image: `data:image/png;base64,${Buffer.concat([png, Buffer.from(String(i))]).toString("base64")}` });
  for (let attempt = 0; attempt < 2; attempt++) {
    const socket = new WebSocket(`ws://127.0.0.1:${(server.address() as { port: number }).port}/whistle/meeting?room=media-burst&id=aaaaaaaa&token=media-burst-private-token`);
    clients.push(socket);
    const codec = createMeetingCodec(), messages: MeetingMessage[] = [];
    socket.on("message", bytes => { const message = codec.decode<MeetingMessage>(bytes.toString()); if (message) messages.push(message); });
    await once(socket, "open");
    const frames = codec.encode({ type: "publish", world }); assert.ok(frames.length > 120);
    for (const frame of frames) socket.send(frame);
    for (let i = 0; i < 400 && !messages.some(m => m.type === "state" && m.view.documentReady); i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.deepEqual(messages.filter(m => m.type === "error"), []);
    const restored = messages.find(m => m.type === "state" && m.view.documentReady);
    assert.ok(restored?.type === "state", "the complete publish must not be silently dropped");
    assert.deepEqual(restored.view.ownWorld.assets, world.assets);
    socket.close(); await once(socket, "close");
  }
});
