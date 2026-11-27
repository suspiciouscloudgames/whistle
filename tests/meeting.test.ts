import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { WebSocket } from "ws";
import { createMeetingRoom, addMeetingMember, publishMeeting, moveMeeting, meetingNeighbors,
  meetingView, meetingWorld, offlineMeetingWorld, retireOfflineMeetingFootings, localMeetingView, withLocalMeetingWorld, meetingVisibleMembers, meetingPresence, meetingOwner, meetingCell, meetingGlobal, meetingLocal,
  connectionCandidates, createMeetingWorld, whistleMeeting, meetingWhistleRecipients, whistleForViewer,
  disconnectMeetingMember, leaveMeetingMember, reconcileMeeting, advanceMeetingTurns, meetingTurn, TURN_DURATION, MEETING_START, MEETING_SIZE,
  type MeetingMessage, type MeetingRoom } from "../lib/meeting.ts";
import { attachMeetingRelay } from "../scripts/meeting/relay.ts";
import { attachPortalRelay } from "../scripts/portals/relay.ts";
import { isVoid } from "../lib/tile.ts";
import { meetingSocketURL, resumeMeetingPosition } from "../lib/meeting-client.ts";
const join=(room:MeetingRoom,id:string,now?:number)=>{const member=addMeetingMember(room,id,now);if(!member.ready)publishMeeting(room,id,member.document);return member;};
const setup=(ids=["a","b"])=>{const room=createMeetingRoom(3);ids.forEach(id=>join(room,id));return room;};
const move=(r:MeetingRoom,id:string,x:number,z:number,grounded=true,playing=true,resetId?:number)=>moveMeeting(r,id,{x,z,yaw:0,grounded},playing,resetId);
const finishTurn=(r:MeetingRoom,id:string)=>{const turn=meetingTurn(r,id);if(turn)advanceMeetingTurns(r,turn.endsAt+(turn.owner===id?0:TURN_DURATION));};
const author=(r:MeetingRoom,id:string,name=`material-${id}`)=>{
  const w=structuredClone(r.members.get(id)!.document);w.assets.push({...w.assets[0],id:name,text:name,solid:false});
  w.objects.push({id:`original-${name}`,asset:name,x:6,z:10,rotation:0,scale:1});publishMeeting(r,id,w,[],true);
  finishTurn(r,id);
  return r.members.get(id)!.shared.get(name)!;
};
const use=(r:MeetingRoom,id:string,gift:string)=>{
  const w=structuredClone(r.members.get(id)!.document),asset=r.members.get(id)!.materials.get(gift)!;
  if(!w.assets.some(a=>a.id===gift))w.assets.push({...asset,text:"edited gift"});
  w.objects.push({id:`placed-${w.objects.length}`,asset:gift,x:6,z:10,rotation:0,scale:1});publishMeeting(r,id,w,[gift]);
};
const open=(r:MeetingRoom,id:string,target:string)=>{
  const gate=meetingView(r,id).connections.find(c=>c.members[1]===target)!;
  assert.ok(gate);move(r,id,gate.x,gate.z);return gate;
};
const paint=(r:MeetingRoom,id:string,x:number,z:number,erase=false)=>{
  const w=structuredClone(r.members.get(id)!.document);w.terrain!.tiles[z*12+x]={height:0,surface:"plain",...(erase?{void:true}:{})};publishMeeting(r,id,w);
};
const disconnected=(r:MeetingRoom)=>{for(const id of r.members.keys())disconnectMeetingMember(r,id);return r;};

test("successive departures leave one return footing, which disappears on reaching my floor and never accumulates",()=>{
  const r=setup(["a"]);
  for(let i=0;i<5;i++){
    const peer=`neighbor-${i}`;join(r,peer);
    const outline=meetingView(r,"a").approaches.find(c=>!c.retired)!;
    const local=meetingLocal(0,outline);
    assert.ok(Math.hypot(local.x-MEETING_START.x,local.z-MEETING_START.z)>=8);
    assert.equal(meetingView(r,peer).approaches.find(c=>c.members[1]==="a")!.z,outline.z);
    use(r,"a",author(r,peer));const gate=open(r,"a",peer);leaveMeetingMember(r,peer);
    const view=meetingView(r,"a");
    assert.equal(view.connections.length,1);
    assert.ok(view.connections.every(c=>!c.online));
    assert.equal(view.ownWorld.connectionFootings!.length,1);
    assert.equal(isVoid(view.world.terrain!.tiles[meetingCell(gate.x,gate.z)]),false);
    const home=meetingGlobal(0,MEETING_START);
    move(r,"a",home.x,home.z);
    const returned=meetingView(r,"a");
    assert.equal(returned.connections.length,0);assert.equal(returned.approaches.length,0);
    assert.deepEqual(returned.ownWorld.connectionFootings,[]);
    assert.equal(isVoid(returned.world.terrain!.tiles[meetingCell(gate.x,gate.z)]),true);
    move(r,"a",home.x,home.z,false);
    assert.equal(meetingView(r,"a").connections.length,0);
    move(r,"a",home.x,home.z);
  }
  join(r,"next");
  const view=meetingView(r,"a");
  assert.equal(view.connections.length,0);assert.equal(view.approaches.length,1);
  assert.equal(view.ownWorld.connectionFootings!.length,1);
});

test("losing the relay preserves the return footing until landing at home, then removes its physical ground locally",()=>{
  const r=setup();use(r,"a",author(r,"b"));const gate=open(r,"a","b"),view=meetingView(r,"a");
  const position={x:gate.x,z:gate.z,yaw:0,grounded:true};
  assert.equal(retireOfflineMeetingFootings(view,position),view);
  assert.equal(retireOfflineMeetingFootings(view,{...position,x:32,z:10}),view);
  const home={...position,...meetingGlobal(0,MEETING_START)};
  assert.equal(retireOfflineMeetingFootings(view,{...home,grounded:false}),view);
  assert.equal(retireOfflineMeetingFootings(view,{...home,falling:true}),view);
  const returned=retireOfflineMeetingFootings(view,home);
  assert.deepEqual(returned.connections,[]);assert.deepEqual(returned.approaches,[]);
  assert.deepEqual(returned.ownWorld.connectionFootings,[]);
  assert.equal(isVoid(returned.world.terrain!.tiles[meetingCell(gate.x,gate.z)]),true);
  assert.equal(isVoid(returned.world.terrain!.tiles[meetingCell(32,10)]),true);
  assert.equal(isVoid(returned.world.terrain!.tiles[meetingCell(home.x,home.z)]),false);
  assert.equal(retireOfflineMeetingFootings(returned,home),returned);
});

test("each return footing stays under a player straddling the edge and retires once both feet clear it", () => {
  for (const [visitor, neighbor, direction] of [["a", "b", -1], ["b", "a", 1]] as const) {
    const room = setup();
    use(room, visitor, author(room, neighbor));
    const gate = open(room, visitor, neighbor);
    paint(room, visitor, direction === 1 ? 0 : 11, gate.z);
    leaveMeetingMember(room, neighbor);
    const view = meetingView(room, visitor);
    const pad = { x: gate.x, z: gate.z, yaw: 0, grounded: true };
    const edge = { ...pad, x: pad.x + direction * .525 };
    const landed = { ...pad, x: pad.x + direction * .61 };
    const reset = { ...view, reset: { id: 1, reason: "disconnect" as const, player: pad } };

    assert.equal(retireOfflineMeetingFootings(view, edge), view);
    assert.equal(resumeMeetingPosition(reset, edge), reset);
    move(room, visitor, edge.x, edge.z);
    assert.equal(meetingView(room, visitor).connections.length, 1);

    assert.equal(retireOfflineMeetingFootings(view, landed).connections.length, 0);
    assert.deepEqual(resumeMeetingPosition(reset, landed).reset.player, landed);
    move(room, visitor, landed.x, landed.z);
    assert.equal(meetingView(room, visitor).connections.length, 0);
  }
});

test("old saved footings are discarded on load and cannot reappear as physical ground or stack beside a new neighbor",()=>{
  const saved=createMeetingWorld(17);
  saved.connectionFootings=Array.from({length:5},(_,row)=>({id:`old-${row}`,side:1,row,built:true,created:row}));
  const local=localMeetingView("returning",saved);
  const offline=withLocalMeetingWorld(local,saved,false);
  assert.deepEqual(local.connections,[]);assert.deepEqual(local.approaches,[]);
  for(let z=0;z<5;z++)assert.equal(isVoid(offline.terrain!.tiles[meetingCell(25,z)]),true);
  const restored=createMeetingRoom(91);addMeetingMember(restored,"returning");
  publishMeeting(restored,"returning",saved);
  assert.equal(meetingView(restored,"returning").connections.length,0);
  join(restored,"new-neighbor");
  const view=meetingView(restored,"returning");
  assert.equal(view.connections.length,0);assert.equal(view.approaches.length,1);
  assert.equal(view.approaches[0].online,true);
  assert.equal(view.ownWorld.connectionFootings!.length,1);
  assert.deepEqual(view.joined,["returning"]);
  for(let z=0;z<5;z++)assert.equal(isVoid(view.world.terrain!.tiles[meetingCell(25,z)]),true);
});

test("stale editor publishes preserve the active footing and cannot restore a retired one",()=>{
  const r=setup();const draft=structuredClone(meetingView(r,"a").ownWorld);
  use(r,"a",author(r,"b"));const gate=open(r,"a","b");
  publishMeeting(r,"a",draft);
  assert.equal(meetingView(r,"a").ownWorld.connectionFootings!.find(p=>p.id===gate.id)!.built,true);
  leaveMeetingMember(r,"b");
  const stale=structuredClone(meetingView(r,"a").ownWorld);
  const home=meetingGlobal(0,MEETING_START);move(r,"a",home.x,home.z);
  publishMeeting(r,"a",stale);
  assert.deepEqual(meetingView(r,"a").ownWorld.connectionFootings,[]);
  join(r,"next");const current=meetingView(r,"a").approaches[0];
  publishMeeting(r,"a",stale);
  assert.deepEqual(meetingView(r,"a").ownWorld.connectionFootings!.map(p=>p.id),[current.id]);
  assert.notEqual(current.id,gate.id);
});

test("restart uses a fresh document without old footings, symbols or receipts",()=>{
  const r=setup();use(r,"a",author(r,"b"));open(r,"a","b");leaveMeetingMember(r,"a");
  join(r,"fresh");
  const view=meetingView(r,"fresh");
  assert.equal(view.connections.length,0);
  assert.equal(view.ownWorld.objects.length,1);
  assert.equal(view.ownWorld.assets.find(a=>a.id===view.ownWorld.objects[0].asset)?.prompt?.title,true);
  assert.deepEqual(view.ownWorld.receivedMaterialIds??[],[]);
  assert.ok(view.ownWorld.connectionFootings?.every(p=>!p.built));
  assert.equal(view.ownWorld.terrain!.tiles.filter(t=>!isVoid(t)).length,14);
});

test("only turn endings share placed originals, and a later partner receives the current completed version",()=>{
  const r=setup(["a"]),w=structuredClone(r.members.get("a")!.document);
  w.assets.push({...w.assets[0],id:"draft",text:"draft"},{...w.assets[0],id:"placed",text:"before play"});
  w.objects.push({id:"placed-symbol",asset:"placed",x:6,z:10,rotation:0,scale:1});
  publishMeeting(r,"a",w);
  join(r,"b");assert.deepEqual(meetingView(r,"b").materials,[]);
  w.assets.at(-1)!.text="played version";
  publishMeeting(r,"a",w,[],true);
  assert.equal(meetingView(r,"b").materials.length,0);
  finishTurn(r,"a");
  const gift=meetingView(r,"b").materials[0];
  assert.equal(meetingView(r,"b").materials.length,1);assert.equal(gift.text,"played version");
  w.assets.at(-1)!.text="unpublished edit";
  publishMeeting(r,"a",w);
  assert.equal(meetingView(r,"b").materials[0].text,"played version");
  disconnectMeetingMember(r,"b",0);reconcileMeeting(r,60_000);
  join(r,"c");assert.equal(meetingView(r,"c").materials.length,0);
  publishMeeting(r,"a",w,[],true);
  assert.equal(meetingView(r,"c").materials.length,0);
  finishTurn(r,"a");
  assert.equal(meetingView(r,"c").materials[0].text,"unpublished edit");
});

test("gift identity survives a new room while edited and deleted gifts remain local",async()=>{
  const {mergeReceivedAssets}=await import("../lib/content-limits.ts");
  const r=setup(),gift=author(r,"a"),original=structuredClone(r.members.get("a")!.document);
  const received=mergeReceivedAssets(r.members.get("b")!.document,meetingView(r,"b").materials).world;
  received.assets.find(a=>a.id===gift)!.text="my edit";
  const again=setup(["new-owner","new-recipient"]);
  publishMeeting(again,"new-owner",original,[],true);
  finishTurn(again,"new-owner");
  const incoming=meetingView(again,"new-recipient").materials;
  assert.equal(incoming[0].id,gift);
  const merged=mergeReceivedAssets(received,incoming).world;
  assert.equal(merged.assets.length,received.assets.length);
  assert.equal(merged.assets.find(a=>a.id===gift)!.text,"my edit");
  merged.assets=merged.assets.filter(a=>a.id!==gift);
  assert.equal(mergeReceivedAssets(merged,incoming).world.assets.some(a=>a.id===gift),false);
});

test("visitors receive revisions and removal of placed images and sounds while keeping their own copies",()=>{
  const room=setup(["a","b","c","d"]);
  use(room,"b",author(room,"a"));
  open(room,"b","a");
  const source=structuredClone(room.members.get("a")!.document);
  const base={shape:"sphere" as const,color:"#223344",solid:false};
  const image={...base,id:"drawing",name:"그림",image:"data:image/png;base64,AQID"};
  const audio={...base,id:"recording",name:"소리",sound:{data:"data:audio/wav;base64,AQID",duration:1,volume:.4,mode:"loop" as const}};
  source.assets.push(image,audio);
  for(const asset of [image,audio])source.objects.push({id:asset.id,asset:asset.id,x:6,z:10,rotation:0,scale:1});
  publishMeeting(room,"a",source,[],false,true);
  const gifts=meetingView(room,"b").materials.filter(asset=>asset.image || asset.sound);
  assert.equal(gifts.length,2);
  const visitor=structuredClone(room.members.get("b")!.document);
  visitor.assets.push(...gifts);
  publishMeeting(room,"b",visitor,gifts.map(asset=>asset.id),false,true);
  image.image="data:image/png;base64,BAUG";
  audio.sound={...audio.sound,data:"data:audio/wav;base64,BwgJ",volume:.8};
  publishMeeting(room,"a",source,[],false,true);
  const view=meetingView(room,"b");
  assert.equal(view.world.assets.find(asset=>asset.id==="a:drawing")?.image,image.image);
  assert.deepEqual(view.world.assets.find(asset=>asset.id==="a:recording")?.sound,audio.sound);
  assert.equal(view.ownWorld.assets.find(asset=>asset.id==="received-drawing")?.image,gifts[0].image);
  assert.equal(view.ownWorld.assets.find(asset=>asset.id==="received-recording")?.sound?.volume,.4);
  source.objects=source.objects.filter(object=>object.asset!=="drawing" && object.asset!=="recording");
  source.assets=source.assets.filter(asset=>asset.id!=="drawing" && asset.id!=="recording");
  publishMeeting(room,"a",source,[],false,true);
  assert.ok(!meetingWorld(room,"b").objects.some(object=>["a:drawing","a:recording"].includes(object.asset)));
  assert.equal(meetingView(room,"b").ownWorld.assets.filter(asset=>asset.image || asset.sound).length,2);
  assert.deepEqual(meetingView(room,"c").materials,[]);
});

test("meeting URLs support secure external relays and reject mixed content",()=>{
  const page=new URL("https://example.com/whistle/?meeting=room");
  assert.equal(meetingSocketURL(page).href,"wss://example.com/whistle/meeting");
  assert.equal(meetingSocketURL(page,"https://relay.example/whistle/meeting").href,"wss://relay.example/whistle/meeting");
  assert.throws(()=>meetingSocketURL(page,"ws://relay.example/whistle/meeting"));
  assert.throws(()=>meetingSocketURL(page,"file:///tmp/meeting"));
  assert.equal(meetingSocketURL(new URL("http://localhost:5173/whistle/")).href,"ws://localhost:5173/whistle/meeting");
});

test("a generated bridge supports visitors and spatial whistles; removing it returns visitors to the lemon footing",()=>{
  const r=setup();use(r,"a",author(r,"b"));const gate=open(r,"a","b");
  const w=structuredClone(r.members.get("b")!.document);
  w.terrain!.tiles[127]={height:0,surface:"plain",void:true};
  w.terrain!.tiles[128]={height:0,surface:"plain"};
  w.objects=[6,8].map(x=>({id:`bridge-${x}`,asset:w.assets[0].id,x,z:10,rotation:0,scale:1}));
  publishMeeting(r,"b",w);move(r,"a",33,10);move(r,"b",20,10);
  assert.equal(r.members.get("a")!.player.x,33);
  assert.equal(r.members.get("b")!.player.x,20);
  assert.deepEqual(meetingWhistleRecipients(r,"a"),["a","b"]);
  const whistle=whistleMeeting(r,"a",1000)!;
  assert.equal(whistleForViewer(r,whistle,"b")!.x,20);
  w.objects=[];publishMeeting(r,"b",w);
  const v=meetingView(r,"a");
  assert.deepEqual([v.reset.player.x,v.reset.player.z],[gate.x,gate.z]);
  assert.equal(v.reset.reason,"floor");assert.equal(v.connections[0].opened,true);
});

test("disconnecting while on my connection footing keeps that position",()=>{
  const r=setup();use(r,"a",author(r,"b"));const gate=open(r,"a","b");
  disconnectMeetingMember(r,"a");
  assert.deepEqual([r.members.get("a")!.player.x,r.members.get("a")!.player.z],[gate.x,gate.z]);
});

test("fixed detached starts and two distant border slots keep every 2D document at 12×12",()=>{
  const r=setup(["a"]),v=meetingView(r,"a");
  assert.deepEqual(v.ownWorld.start,MEETING_START);assert.equal(v.ownWorld.size,12);assert.equal(v.world.size,MEETING_SIZE);
  assert.equal(v.ownWorld.terrain!.tiles.filter(t=>!isVoid(t)).length,14);assert.equal(v.connections.length,0);assert.equal(v.approaches.length,0);
  v.ownWorld.terrain!.tiles.forEach((tile,i)=>{const p=meetingGlobal(0,{x:i%12,z:Math.floor(i/12)});assert.deepEqual(v.world.terrain!.tiles[meetingCell(p.x,p.z)],tile);});
  for(const region of [1,2]){
    const p=connectionCandidates(0,region)[0],local=meetingLocal(0,p);
    assert.ok(Math.hypot(local.x-MEETING_START.x,local.z-MEETING_START.z)>=8);assert.equal(meetingOwner(p.x,p.z),-1);
  }
  const changed=structuredClone(v.ownWorld);changed.start={x:11,z:1};changed.terrain!.tiles[23]={height:0,surface:"plain"};
  assert.throws(()=>publishMeeting(r,"a",changed),/고정/);
  join(r,"a");assert.deepEqual(meetingView(r,"a").ownWorld,v.ownWorld);
  publishMeeting(r,"a",createMeetingWorld(29));assert.equal(meetingView(r,"a").world.terrain!.tiles.filter(t=>!isVoid(t)).length,14);
});

test("arrivals form a stable chain, including odd attendance and a fourth person without splitting an existing pair",()=>{
  const r=setup();const ab=meetingView(r,"a").approaches[0];
  join(r,"c");assert.deepEqual(meetingNeighbors(r,"a"),["b"]);assert.deepEqual(meetingNeighbors(r,"b"),["a","c"]);
  join(r,"d");assert.deepEqual(r.chain,["a","b","c","d"]);assert.deepEqual(meetingNeighbors(r,"c"),["b","d"]);
  assert.equal(meetingView(r,"a").approaches[0].id,ab.id);
  for(let i=0;i<17;i++)join(r,`extra-${i}`);
  for(const id of r.chain){const v=meetingView(r,id);assert.equal(v.recipients.length,meetingTurn(r,id)?1:0);assert.ok(v.approaches.length<=2);assert.equal(v.world.size,MEETING_SIZE);assert.deepEqual(v.joined,[id]);}
  assert.equal(meetingPresence(r,"a").onlineCount,21);assert.equal(meetingPresence(r,"a").peers.length,2);
});

test("only partners receive original materials; edited copies stay local and provenance survives deletion",()=>{
  const r=setup(["a","b","c"]),gift=author(r,"a");
  assert.equal(meetingView(r,"b").materials[0].id,gift);assert.equal(meetingView(r,"c").materials.length,0);
  use(r,"b",gift);assert.equal(meetingView(r,"c").materials.length,0);assert.equal(meetingView(r,"a").materials.length,0);
  const own=structuredClone(r.members.get("a")!.document);own.assets=own.assets.filter(a=>a.id!=="material-a");own.objects=own.objects.filter(o=>o.asset!=="material-a");publishMeeting(r,"a",own);
  const saved=disconnected(r);join(saved,"a");join(saved,"b");
  assert.equal(meetingView(saved,"b").connections[0].members[1],"a");
  const b=structuredClone(saved.members.get("b")!.document);b.objects=[];b.assets=b.assets.filter(a=>a.id!==gift);publishMeeting(saved,"b",b,[gift]);
  assert.ok(meetingView(saved,"b").received.includes(gift));assert.equal(meetingView(saved,"b").connections.length,1);
});

test("a neighbor starts as a nonphysical outline; only placing that neighbor's material activates my one footing",()=>{
  const r=setup(["a","b","c"]),gift=author(r,"b"),outline=meetingView(r,"a").approaches[0];
  assert.equal(isVoid(meetingWorld(r,"a").terrain!.tiles[meetingCell(outline.x,outline.z)]),true);
  paint(r,"a",11,1);assert.equal(r.connections.length,0);
  const w=structuredClone(r.members.get("a")!.document);w.assets.push({...r.members.get("a")!.materials.get(gift)!,text:"edited"});publishMeeting(r,"a",w,[gift]);
  assert.equal(r.connections.length,0);use(r,"a",gift);
  const gate=meetingView(r,"a").connections[0];assert.equal(gate.id,outline.id);assert.equal(gate.x,25);assert.equal(gate.z,outline.z);
  assert.equal(meetingView(r,"a").approaches.length,0);assert.equal(meetingView(r,"b").connections.length,0);assert.equal(meetingView(r,"b").approaches.length,1);
  use(r,"a",gift);assert.equal(meetingView(r,"a").connections.length,1);
});

test("one grounded visitor reveals only their view, with no simultaneous standing or transitive opening",()=>{
  const r=setup(["a","b","c"]);use(r,"a",author(r,"b"));const gate=meetingView(r,"a").connections[0];
  assert.equal(move(r,"a",gate.x,gate.z,false),false);assert.equal(move(r,"a",gate.x,gate.z,true,false),false);
  assert.deepEqual(meetingView(r,"a").joined,["a"]);assert.equal(r.members.get("b")!.playing,false);
  assert.equal(move(r,"a",gate.x,gate.z),true);assert.deepEqual(meetingView(r,"a").joined,["a","b"]);assert.deepEqual(meetingView(r,"b").joined,["b"]);
  assert.equal(isVoid(meetingWorld(r,"a").terrain!.tiles[meetingCell(26,gate.z)]),true);
  paint(r,"b",0,gate.z);assert.equal(isVoid(meetingWorld(r,"a").terrain!.tiles[meetingCell(26,gate.z)]),false);
  move(r,"a",26,gate.z);assert.equal(r.members.get("a")!.player.x,26);
  const before={...r.members.get("b")!.player};move(r,"b",6,10,false);assert.deepEqual(r.members.get("b")!.player,before);
  assert.deepEqual(meetingView(r,"c").recipients,[]);assert.deepEqual(meetingView(r,"c").connections,[]);
  assert.deepEqual(meetingView(r,"a").joined,["a","b"]);
  assert.ok(meetingView(r,"a").world.assets.every(a=>!a.id.startsWith("c:")));
  use(r,"b",author(r,"a"));const reverse=open(r,"b","a");assert.equal(reverse.x,12);assert.equal(reverse.z,gate.z);
  const saved=disconnected(r);r.chain.forEach(id=>join(saved,id));assert.deepEqual(saved.links,r.links);
});

test("editing elsewhere leaves a visitor alone; removing their support returns them to the lemon footing and keeps the world visible",()=>{
  const r=setup();use(r,"a",author(r,"b"));const gate=open(r,"a","b");paint(r,"b",0,gate.z);move(r,"a",26,gate.z);
  const reset=r.members.get("a")!.reset.id;paint(r,"b",3,3);assert.equal(r.members.get("a")!.reset.id,reset);
  paint(r,"b",0,gate.z,true);const v=meetingView(r,"a");
  assert.deepEqual([v.reset.player.x,v.reset.player.z],[gate.x,gate.z]);assert.equal(v.reset.reason,"floor");assert.equal(v.reset.id,reset+1);
  assert.equal(v.connections[0].online,true);assert.equal(v.connections[0].opened,true);assert.deepEqual(v.joined,["a","b"]);
  move(r,"a",32,10,true,true,reset);assert.equal(r.members.get("a")!.player.x,gate.x);
  move(r,"a",32,10,true,true,v.reset.id);assert.equal(r.members.get("a")!.player.x,32);
});

test("disconnect returns a visitor to the black footing and hides the world; a quick reconnect restores the same neighbor",()=>{
  const r=setup();use(r,"a",author(r,"b"));const gate=open(r,"a","b");move(r,"a",32,10);
  const now=Date.now();disconnectMeetingMember(r,"b",now);const v=meetingView(r,"a");
  assert.deepEqual([v.reset.player.x,v.reset.player.z],[gate.x,gate.z]);assert.equal(v.connections[0].online,false);assert.deepEqual(v.joined,["a"]);
  assert.equal(isVoid(v.world.terrain!.tiles[meetingCell(32,10)]),true);assert.equal(isVoid(v.world.terrain!.tiles[meetingCell(gate.x,gate.z)]),false);
  reconcileMeeting(r,now+59_999);assert.deepEqual(r.chain,["a","b"]);
  join(r,"b",now+59_999);assert.equal(meetingView(r,"a").connections[0].id,gate.id);assert.deepEqual(meetingView(r,"a").joined,["a","b"]);
});

test("a new partner waits for a visitor to walk home before replacing the black footing",()=>{
  const r=setup(["a","b","c","d"]),oldGift=author(r,"b");use(r,"a",oldGift);const gate=open(r,"a","b");move(r,"a",32,10);
  const cd=meetingView(r,"c").approaches.find(c=>c.members[1]==="d")!;
  const now=Date.now();disconnectMeetingMember(r,"b",now);reconcileMeeting(r,now+60_000);
  assert.deepEqual(r.chain,["a","c","d"]);assert.deepEqual(meetingNeighbors(r,"c"),["a","d"]);
  assert.equal(meetingTurn(r,"a"),undefined);
  assert.equal(meetingView(r,"a").approaches.filter(c=>!c.retired).length,0);
  const reset=meetingView(r,"a").reset.id;
  join(r,"e",now+60_001);
  const waiting=meetingView(r,"a");
  assert.equal(waiting.connections.length,1);assert.equal(waiting.approaches.length,0);
  assert.equal(waiting.reset.id,reset);
  assert.deepEqual([r.members.get("a")!.player.x,r.members.get("a")!.player.z],[gate.x,gate.z]);
  assert.equal(isVoid(waiting.world.terrain!.tiles[meetingCell(gate.x,gate.z)]),false);
  const home=meetingGlobal(0,MEETING_START);move(r,"a",home.x,home.z);
  const v=meetingView(r,"a"),replacement=v.approaches.find(c=>!c.retired)!;assert.equal(v.connections.length,0);assert.deepEqual(v.joined,["a"]);
  assert.deepEqual(v.recipients,["e"]);
  assert.notDeepEqual([replacement.x,replacement.z],[gate.x,gate.z]);assert.equal(replacement.online,true);assert.notEqual(replacement.id,gate.id);
  assert.ok(v.ownWorld.assets.some(a=>a.id===oldGift));assert.equal(meetingView(r,"c").approaches.find(c=>c.members[1]==="d")!.id,cd.id);
  assert.equal(isVoid(v.world.terrain!.tiles[meetingCell(gate.x,gate.z)]),true);
  move(r,"a",gate.x,gate.z);assert.deepEqual(meetingView(r,"a").joined,["a"]);
  use(r,"a",author(r,"e"));open(r,"a","e");assert.deepEqual(meetingView(r,"a").joined,["a","e"]);
  join(r,"b",now+60_002);assert.deepEqual(r.chain,["a","c","d","e","b"]);assert.deepEqual(meetingView(r,"b").recipients,[]);
});

test("a departure while already home leaves no black footing, and the next arrival creates only its own approach",()=>{
  const r=setup();use(r,"a",author(r,"b"));open(r,"a","b");
  const home=meetingGlobal(0,MEETING_START);move(r,"a",home.x,home.z);
  const now=Date.now();disconnectMeetingMember(r,"b",now);reconcileMeeting(r,now+60_000);
  assert.equal(meetingView(r,"a").connections.length,0);join(r,"c",now+60_001);
  const v=meetingView(r,"a");assert.equal(v.connections.length,0);assert.equal(v.approaches.length,1);
  assert.equal(v.approaches[0].online,true);assert.equal(v.ownWorld.connectionFootings!.length,1);
});

test("materials placed while waiting on a black footing build the new partner's footing immediately after walking home",()=>{
  const r=setup();use(r,"a",author(r,"b"));const old=open(r,"a","b");
  leaveMeetingMember(r,"b");join(r,"c");
  use(r,"a",author(r,"c"));
  const waiting=meetingView(r,"a");
  assert.equal(waiting.connections[0].id,old.id);assert.equal(waiting.connections[0].online,false);
  const home=meetingGlobal(0,MEETING_START);move(r,"a",home.x,home.z);
  const view=meetingView(r,"a");
  assert.equal(view.connections.length,1);assert.equal(view.approaches.length,0);
  assert.equal(view.connections[0].online,true);assert.notEqual(view.connections[0].id,old.id);
  assert.equal(view.ownWorld.connectionFootings!.length,1);
  assert.equal(isVoid(view.world.terrain!.tiles[meetingCell(old.x,old.z)]),true);
});

test("spatial whistles translate the same physical world into each listener's coordinates",()=>{
  const r=setup(["a","b","c"]);move(r,"a",19,10);assert.equal(whistleMeeting(r,"a",1000),null);
  use(r,"a",author(r,"b"));open(r,"a","b");move(r,"b",19,10);move(r,"a",19,10);
  assert.deepEqual(meetingWhistleRecipients(r,"a"),["a"]);move(r,"a",32,10);
  assert.deepEqual(meetingWhistleRecipients(r,"a"),["a","b"]);assert.deepEqual(meetingView(r,"b").joined,["b"]);
  const event=whistleMeeting(r,"a",1000)!;assert.ok(event);assert.equal(whistleForViewer(r,event,"b")!.x,19);
  assert.equal(meetingPresence(r,"b").peers.find(p=>p.id==="a")!.player!.x,19);assert.equal(whistleMeeting(r,"a",1100),null);assert.ok(whistleMeeting(r,"a",1400));
  assert.ok(whistleMeeting(r,"b",1000));assert.equal(whistleForViewer(r,event,"c"),null);
});

test("six originals are enforced while received materials and repeated placements do not use the original limit",()=>{
  const r=setup(),own=structuredClone(r.members.get("a")!.document);
  for(let i=0;i<6;i++){
    own.assets.push({...own.assets[0],id:`own-${i}`,text:`${i}`});
    own.objects.push({id:`placed-${i}`,asset:`own-${i}`,x:6,z:10,rotation:0,scale:1});
  }
  publishMeeting(r,"a",own,[],true);
  finishTurn(r,"a");
  const seventh=structuredClone(own);seventh.assets.push({...own.assets[0],id:"seventh",text:"7"});assert.throws(()=>publishMeeting(r,"a",seventh),/6종/);
  assert.equal(meetingView(r,"b").materials.length,6);use(r,"b",meetingView(r,"b").materials[0].id);
  for(let i=0;i<6;i++)author(r,"b",`local-${i}`);assert.equal(meetingView(r,"a").materials.length,6);
});

test("relay isolates rooms, handles arrivals during disconnects, and coexists with the old portal endpoint",async t=>{
  const server=createServer(),relay=attachMeetingRelay(server,{reconnectMs:60,cleanupMs:10}),old=attachPortalRelay(server),clients:WebSocket[]=[];
  server.listen(0,"127.0.0.1");await once(server,"listening");const port=(server.address() as {port:number}).port;
  t.after(async()=>{clients.forEach(c=>c.terminate());await relay.close();old.close();await new Promise<void>(r=>server.close(()=>r()));});
  async function connect(room:string,id:string){
    const ws=new WebSocket(`ws://127.0.0.1:${port}/whistle/meeting?room=${room}&id=${id}&token=${id}-private-resume-token`);clients.push(ws);
    const messages:MeetingMessage[]=[];ws.on("message",data=>messages.push(JSON.parse(data.toString())));
    const wait=async(predicate:(m:MeetingMessage)=>boolean)=>{for(let i=0;i<400;i++){const n=messages.findIndex(predicate);if(n>=0)return messages.splice(n,1)[0];await new Promise(r=>setTimeout(r,5));}throw Error("Missing meeting message");};
    await once(ws,"open");ws.send(JSON.stringify({type:"publish",world:createMeetingWorld()}));const initial=await wait(m=>m.type==="state"&&m.view.documentReady);assert.equal(initial.type,"state");return {ws,wait,initial};
  }
  const a=await connect("same","aaaaaaaa"),b=await connect("same","bbbbbbbb"),c=await connect("same","cccccccc"),d=await connect("same","dddddddd"),other=await connect("other","zzzzzzzz");
  assert.equal(other.initial.presence.onlineCount,1);assert.deepEqual(d.initial.view.recipients,["cccccccc"]);
  b.ws.close();await once(b.ws,"close");
  await connect("same","eeeeeeee");
  const reassigned=await a.wait(m=>m.type==="state"&&m.view.recipients.includes("eeeeeeee"));assert.equal(reassigned.type,"state");
  assert.equal(reassigned.view.approaches.find(c=>!c.retired)!.online,true);assert.equal(reassigned.presence.onlineCount,4);
  const next=await connect("same","bbbbbbbb");assert.deepEqual(next.initial.view.recipients,[]);
});


test("the visitor's own socket disconnect also returns them to their black footing",()=>{
  const r=setup();use(r,"a",author(r,"b"));const gate=open(r,"a","b");move(r,"a",32,10);
  const offline=offlineMeetingWorld(meetingView(r,"a"));
  assert.equal(isVoid(offline.terrain!.tiles[meetingCell(32,10)]),true);
  assert.equal(isVoid(offline.terrain!.tiles[meetingCell(gate.x,gate.z)]),false);
  assert.ok(offline.assets.every(a=>a.id.startsWith("a:")));
  disconnectMeetingMember(r,"a");const v=meetingView(r,"a");
  assert.deepEqual([v.reset.player.x,v.reset.player.z],[gate.x,gate.z]);assert.equal(v.connections[0].online,false);
  assert.ok(v.reset.player.pitch!<0);join(r,"a");assert.equal(meetingView(r,"a").connections[0].online,true);
});

test("resuming a visit before its host reconnects places the visitor on their own footing",()=>{
  const r=setup();use(r,"a",author(r,"b"));const gate=open(r,"a","b");move(r,"a",32,10);
  const saved=disconnected(r);join(saved,"a");const v=meetingView(saved,"a");
  assert.deepEqual([saved.members.get("a")!.player.x,saved.members.get("a")!.player.z],[gate.x,gate.z]);
  assert.equal(v.reset.reason,"disconnect");assert.deepEqual(v.joined,["a"]);
});

test("a new arrival preserves a disconnected neighbor during the reconnect grace",()=>{
  const r=setup();use(r,"a",author(r,"b"));const gate=open(r,"a","b"),now=Date.now();
  disconnectMeetingMember(r,"b",now);join(r,"c",now+1);
  assert.deepEqual(r.chain,["a","b","c"]);
  const v=meetingView(r,"a");assert.equal(v.connections[0].id,gate.id);
  assert.equal(v.connections[0].online,false);
  join(r,"b",now+2);
  assert.deepEqual(meetingView(r,"a").recipients,["b"]);
  assert.deepEqual(meetingView(r,"c").recipients,[]);
  assert.equal(meetingView(r,"a").connections[0].id,gate.id);
});

test("presence clocks and movement do not invalidate connection UI, but connection and turn changes do", async () => {
  const { sameMeetingPresence, sameMeetingPosition } = await import("../lib/meeting-client.ts");
  const original = { peers: [{ id: "a", slot: 0, playing: true, online: true, player: { x: 19, z: 10, yaw: 0, grounded: true } }],
    canWhistle: false, onlineCount: 1, turn: { owner: "a", partner: "b", startedAt: 1000, endsAt: 61000, serverNow: 1000 } };
  const moved = structuredClone(original); moved.peers[0].player.x++;
  moved.turn.serverNow += 80;
  assert.equal(sameMeetingPresence(original, moved), true);
  for (const changed of [{ ...original, onlineCount: 2 }, { ...original, canWhistle: true },
    { ...original, turn: { ...original.turn, owner: "b", endsAt: 121000 } },
    { ...original, peers: [{ ...original.peers[0], online: false }] }])
    assert.equal(sameMeetingPresence(original, changed), false);
  const p = original.peers[0].player;
  assert.equal(sameMeetingPosition(p, { ...p }), true);
  assert.equal(sameMeetingPosition(p, { ...p, x: p.x + .00001 }), true);
  for (const changed of [{ ...p, x: p.x + .01 }, { ...p, yaw: .1 }, { ...p, grounded: false }, { ...p, falling: true }])
    assert.equal(sameMeetingPosition(p, changed), false);
});

test("reconnecting after walking home keeps the current safe position instead of replaying the return teleport", () => {
  const r = setup(); use(r, "a", author(r, "b")); const gate = open(r, "a", "b");
  const view = meetingView(r, "a");
  view.reset = { id: 5, reason: "disconnect", player: { x: gate.x, z: gate.z, yaw: 0, grounded: true } };
  const home = { ...meetingGlobal(0, MEETING_START), yaw: 1, grounded: true };
  const resumed = resumeMeetingPosition(view, home);
  assert.equal(resumed.reset.id, 5);
  assert.deepEqual(resumed.reset.player, home);
  for (const unsafe of [null, { ...home, grounded: false }, { ...home, falling: true }, view.reset.player, { ...home, x: 32 }])
    assert.equal(resumeMeetingPosition(view, unsafe), view);
  for (const tile of [{ height: 0, surface: "plain" as const, void: true }, { height: 0, surface: "plain" as const, hole: true }]) {
    const missing = structuredClone(view);
    missing.ownWorld.terrain!.tiles[MEETING_START.z * 12 + MEETING_START.x] = tile;
    assert.equal(resumeMeetingPosition(missing, home), missing);
  }
  const floorReset = { ...view, reset: { ...view.reset, reason: "floor" as const } };
  assert.equal(resumeMeetingPosition(floorReset, home), floorReset);
});

test("a first gate crossing places one bonus on the bordering home tile on either side, even after a stale publish", () => {
  for (const [visitor,host] of [["a","b"],["b","a"]]) {
    for (const occupied of [false,true]) {
      const room=setup();
      use(room,visitor,author(room,host));
      const gate=meetingView(room,visitor).connections[0];
      const x=gate.x===12 ? 0 : 11, z=gate.z;
      const own=structuredClone(room.members.get(visitor)!.document);
      own.terrain!.tiles[z*12+x]={height:0,surface:"plain"};
      if (occupied) own.objects.push({...own.objects[0],id:"already-here",x,z});
      publishMeeting(room,visitor,own);
      const atGate = () => room.members.get(visitor)!.document.objects.filter(o=>o.x===x && o.z===z);
      open(room,visitor,host);
      assert.equal(atGate().length,1);
      assert.equal(atGate()[0].id,occupied ? "already-here" : gate.id+"-bonus");
      const expected=structuredClone(atGate());
      assert.equal(room.members.get(visitor)!.document.workshop!.lastGate,gate.id);
      assert.equal(room.members.get(host)!.document.workshop!.lastGate,undefined);
      publishMeeting(room,visitor,own);
      open(room,visitor,host);
      assert.deepEqual(atGate(),expected);
      const edited=structuredClone(room.members.get(visitor)!.document);
      edited.objects=edited.objects.filter(o=>o.x!==x || o.z!==z);
      publishMeeting(room,visitor,edited);
      open(room,visitor,host);
      assert.deepEqual(atGate(),[]);
    }
  }
});

test("a reconnect that never publishes its document releases the waiting partner at the grace deadline", () => {
  const room=setup(), now=Date.now();
  disconnectMeetingMember(room,"b",now);
  addMeetingMember(room,"b",now+2000,true);
  join(room,"late",now+3000);
  assert.equal(meetingTurn(room,"a"),undefined);
  reconcileMeeting(room,now+60_000);
  assert.equal(meetingTurn(room,"a")?.partner,"late");
});

test("an interrupted return to an opened world only restores the link inside the reservation", () => {
  for (const expired of [false, true]) {
    const room = setup();
    use(room,"a",author(room,"b"));
    open(room,"a","b");
    const now = Date.now();
    disconnectMeetingMember(room,"b",now);
    addMeetingMember(room,"b",now+5000,true);
    assert.equal(meetingPresence(room,"a").canWhistle,false);
    assert.deepEqual(meetingView(room,"a").joined,["a"]);
    const resumeAt = now + (expired ? 65_000 : 10_000);
    publishMeeting(room,"b",room.members.get("b")!.document,[],false,true,resumeAt);
    assert.deepEqual(meetingView(room,"a").recipients,["b"]);
    assert.deepEqual(meetingView(room,"a").joined,expired ? ["a"] : ["a","b"]);
    assert.equal(meetingPresence(room,"a").canWhistle,!expired);
    assert.equal(meetingTurn(room,"a",resumeAt)?.partner,expired ? "b" : undefined);
  }
});
