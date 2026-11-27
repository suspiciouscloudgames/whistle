import test from "node:test";
import assert from "node:assert/strict";
import { createMeetingWorld, createMeetingRoom, addMeetingMember, publishMeeting, meetingTurn, advanceMeetingTurns,
  meetingView, moveMeeting, disconnectMeetingMember, TURN_DURATION, type MeetingRoom } from "../lib/meeting.ts";
import { emptySymbol, completeSymbol, refillSymbols, initializeWorkshop, isContentEdit, TURN_HINT } from "../lib/workshop.ts";
import { TURN_TILE_HINT } from "../lib/turn-tiles.ts";
import { validateWorld, type World, type Asset } from "../lib/world.ts";
import { deriveStructures } from "../lib/terrain.ts";
import { contentKind, MAX_LIBRARY_SIZE } from "../lib/content-limits.ts";

const image = "data:image/png;base64,AAAA";
function fill(w: World, asset: Asset, text = "작은 장면") {
  const next = {...asset, ...(asset.prompt?.kind === "text" ? {text,image} : asset.prompt?.kind === "image" ? {image} :
    {sound:{data:"data:audio/wav;base64,AAAA",duration:1,volume:.7,mode:"loop" as const}})};
  w.assets[w.assets.findIndex(a=>a.id===asset.id)] = next;
  completeSymbol(w,asset);
  return next;
}
function pair(now=Date.now()) {
  const room=createMeetingRoom(19);
  for(const id of ["a","b"]){addMeetingMember(room,id,now);publishMeeting(room,id,structuredClone(room.members.get(id)!.document),[],false,true,now);}
  return room;
}
function buildConnection(room: MeetingRoom, now: number) {
  for(const id of ["a","b"]){
    const world=structuredClone(room.members.get(id)!.document);
    fill(world,world.assets.find(emptySymbol)!,`world ${id}`);
    publishMeeting(room,id,world,[],false,true,now+1);
  }
  advanceMeetingTurns(room,now+TURN_DURATION);
  const gift=meetingView(room,"b").materials[0];
  const world=structuredClone(room.members.get("b")!.document);
  world.assets.push(gift);
  world.objects.push({id:"received-title",asset:gift.id,...world.start,rotation:0,scale:1});
  publishMeeting(room,"b",world,[gift.id],false,true,now+TURN_DURATION+1);
  return meetingView(room,"b").connections[0];
}
function crossConnection(room: MeetingRoom, gate: {x:number;z:number}) {
  assert.equal(moveMeeting(room,"b",{x:gate.x,z:gate.z,yaw:0,grounded:true},true),true);
}

test("a fresh world has one neutral title at the front-left and globally unique prompt ids",()=>{
  const a=createMeetingWorld(12), b=createMeetingWorld(12);
  assert.equal(a.objects.length,1);
  const title=a.assets.find(emptySymbol)!;
  assert.deepEqual(title.prompt,{kind:"text",title:true});
  assert.equal(title.glyphColor,undefined);
  assert.deepEqual([a.objects[0].x,a.objects[0].z],[a.start.x-1,a.start.z-1]);
  assert.notEqual(title.id,b.assets.find(emptySymbol)!.id);
  assert.deepEqual(validateWorld(a,MAX_LIBRARY_SIZE),a);
});

test("filling the title supplies only an image; editing, copying and reloading do not supply more",()=>{
  const w=createMeetingWorld(1),title=w.assets.find(emptySymbol)!;
  fill(w,title);
  assert.equal(w.title,"작은 장면");
  assert.deepEqual(w.assets.filter(emptySymbol).map(a=>a.prompt!.kind),["image"]);
  const saved=JSON.stringify(w.workshop), count=w.objects.length;
  fill(w,w.assets.find(a=>a.id===title.id)!,"수정한 제목");
  assert.equal(w.title,"수정한 제목");
  assert.equal(JSON.stringify(w.workshop),saved);
  assert.equal(w.objects.length,count);
  w.objects.push({...w.objects[0],id:"copy",x:4,z:9});refillSymbols(w);
  assert.equal(w.objects.length,count+1);
  assert.equal(w.assets.filter(emptySymbol).length,1);
  const reloaded=validateWorld(JSON.parse(JSON.stringify(w)),MAX_LIBRARY_SIZE);
  refillSymbols(reloaded);assert.deepEqual(reloaded,w);
});

test("prompts rotate text, image and sound one at a time and stop at the material limit",()=>{
  const w=createMeetingWorld(2);
  w.terrain!.tiles.forEach(t=>{t.void=false;});
  for(const kind of ["text","image","sound","text","image","sound"]){
    const prompts=w.assets.filter(emptySymbol);
    assert.equal(prompts.length,1);
    assert.equal(prompts[0].prompt!.kind,kind);
    fill(w,prompts[0]);
  }
  assert.equal(w.assets.filter(emptySymbol).length,0);
  assert.equal(w.assets.filter(contentKind).length,6);
  assert.equal(w.workshop!.pending.length,1);
});

test("a prompt waits through holes and adjacent floors, then uses a floor two tiles away",()=>{
  const w=createMeetingWorld(2),title=w.assets.find(emptySymbol)!;
  for(const tile of w.terrain!.tiles)tile.void=true;
  fill(w,title);
  assert.equal(w.assets.filter(emptySymbol).length,0);
  assert.equal(w.workshop!.pending.length,1);
  w.terrain!.tiles[0]={surface:"plain",height:0,hole:true};
  w.terrain!.tiles[8*w.size+5]={surface:"rough",height:0};
  w.terrain!.tiles[8*w.size+6]={surface:"soft",height:0};
  refillSymbols(w);
  assert.equal(w.assets.filter(emptySymbol).length,0);
  w.terrain!.tiles[9*w.size+3]={surface:"plain",height:0};refillSymbols(w);
  assert.equal(w.assets.filter(emptySymbol).length,1);
  assert.deepEqual([w.objects.at(-1)!.x,w.objects.at(-1)!.z],[3,9]);
  assert.equal(w.workshop!.pending.length,0);
  w.terrain!.tiles[0]={surface:"soft",height:0};refillSymbols(w);
  assert.equal(w.assets.filter(emptySymbol).length,1);
  fill(w,w.assets.find(emptySymbol)!);
  assert.equal(w.assets.find(emptySymbol)!.prompt!.kind,"sound");
  assert.deepEqual([w.objects.at(-1)!.x,w.objects.at(-1)!.z],[0,0]);
});

test("all floor surfaces can receive prompts, including lowered water with no hole",()=>{
  for(const surface of ["plain","rough","soft","slick"] as const){
    const w=createMeetingWorld(2),title=w.assets.find(emptySymbol)!;
    for(const tile of w.terrain!.tiles)tile.void=true;
    fill(w,title);
    w.terrain!.tiles[0]={surface,height:surface==="slick"?-1:0,hole:false};
    refillSymbols(w);
    assert.equal(w.assets.find(emptySymbol)!.prompt!.kind,"image");
    assert.deepEqual([w.objects.at(-1)!.x,w.objects.at(-1)!.z],[0,0]);
  }
  const missing=createMeetingWorld(2);delete missing.terrain;
  fill(missing,missing.assets.find(emptySymbol)!);
  assert.equal(missing.assets.filter(emptySymbol).length,0);
});

test("each new prompt uses the nearest spaced floor to the symbol just filled",()=>{
  const w=createMeetingWorld(2),title=w.assets.find(emptySymbol)!;
  for(const tile of w.terrain!.tiles)tile.void=true;
  w.assets.push({...title,id:"received-image",prompt:undefined,image,received:true},
    {...title,id:"received-sound",prompt:undefined,received:true,sound:{data:"data:audio/wav;base64,AAAA",duration:1,volume:.7,mode:"loop"}});
  w.objects.push({id:"picture",asset:"received-image",x:0,z:0,rotation:0,scale:1},
    {id:"sound",asset:"received-sound",x:11,z:0,rotation:0,scale:1},
    {id:"title-copy",asset:title.id,x:11,z:9,rotation:0,scale:1});
  for(const [x,z] of [[0,1],[10,0],[5,8],[5,7],[0,7],[5,3],[11,6],[2,9],[5,6]])w.terrain!.tiles[z*w.size+x]={surface:"plain",height:0};
  fill(w,title);
  const placed=w.objects.at(-1)!;
  assert.deepEqual([placed.x,placed.z],[5,6]);
  assert.ok(w.objects.slice(0,-1).every(o=>Math.hypot(placed.x-o.x,placed.z-o.z)>=3));
  fill(w,w.assets.find(emptySymbol)!);
  const next=w.objects.at(-1)!;
  assert.deepEqual([next.x,next.z],[5,3]);
});

test("old saves keep one empty symbol and all completed work, including during the other player's turn",()=>{
  const before=createMeetingWorld(2);fill(before,before.assets.find(emptySymbol)!);
  const current=before.assets.find(emptySymbol)!;
  before.assets.push({...current,id:"old-sound-prompt",prompt:{kind:"sound"}});
  before.objects.push({id:"old-sound-site",asset:"old-sound-prompt",x:5,z:8,rotation:0,scale:1});
  before.workshop!.next=0;
  before.workshop!.pending=[{kind:"text",x:5,z:9},{kind:"image",x:5,z:9}];
  const snapshot=structuredClone(before),after=initializeWorkshop(structuredClone(before));
  assert.deepEqual(after.assets.filter(emptySymbol).map(a=>a.id),[current.id]);
  assert.deepEqual(after.assets.filter(contentKind),before.assets.filter(contentKind));
  assert.equal(after.workshop!.pending.length,0);
  assert.equal(isContentEdit(before,after),true);
  assert.deepEqual(before,snapshot);
  assert.deepEqual(initializeWorkshop(structuredClone(after)),after);
  fill(after,after.assets.find(emptySymbol)!);
  assert.equal(after.assets.find(emptySymbol)!.prompt!.kind,"sound");
  assert.equal(isContentEdit(before,after),true);
  const forged=structuredClone(after);
  const completed=forged.assets.find(contentKind)!;
  forged.assets=forged.assets.filter(a=>a.id!==completed.id);
  forged.objects=forged.objects.filter(o=>o.asset!==completed.id);
  assert.equal(isContentEdit(before,forged),false);
});

test("empty symbols cannot accidentally create a bridge or canopy",()=>{
  const w=createMeetingWorld(3),a=w.assets.find(emptySymbol)!;
  w.terrain!.tiles.forEach(t=>{t.void=false;t.height=0;t.surface="plain";});
  w.objects=[[2,2],[4,2],[2,4],[4,4]].map(([x,z],i)=>({id:`p${i}`,asset:a.id,x,z,scale:1,rotation:0}));
  assert.equal(deriveStructures(w).length,0);
});

test("an unplaced empty symbol is restored on a spaced floor without multiplying or losing its kind", () => {
  const world = createMeetingWorld(2);
  fill(world, world.assets.find(emptySymbol)!);
  const prompt = world.assets.find(emptySymbol)!;
  world.objects = world.objects.filter(o => o.asset !== prompt.id);
  for (const tile of world.terrain!.tiles) tile.void = true;
  refillSymbols(world);
  assert.equal(world.assets.filter(emptySymbol).length, 1);
  assert.equal(world.objects.some(o => o.asset === prompt.id), false);
  world.terrain!.tiles[0] = {surface: "slick", height: -1, hole: false};
  refillSymbols(world);
  assert.deepEqual(world.objects.filter(o => o.asset === prompt.id).map(o => [o.x, o.z]), [[0, 0]]);
  const snapshot = structuredClone(world);
  refillSymbols(world);
  assert.deepEqual(world, snapshot);
  assert.equal(world.assets.find(emptySymbol)!.prompt!.kind, "image");
});

test("off-turn content edits and earned replenishment are allowed, relocation and terrain are not",()=>{
  const before=createMeetingWorld(4),after=structuredClone(before);
  fill(after,after.assets.find(emptySymbol)!);
  assert.equal(isContentEdit(before,after),true);
  const moved=structuredClone(after);moved.objects[0].x--;
  assert.equal(isContentEdit(before,moved),false);
  const terrain=structuredClone(after);terrain.terrain!.tiles[0]={height:0,surface:"soft"};
  assert.equal(isContentEdit(before,terrain),false);
  const forged=structuredClone(after);forged.objects.push({...forged.objects[0],id:"unearned",x:0,z:0});
  assert.equal(isContentEdit(before,forged),false);
});

test("a server-owned minute alternates and delivers filled materials before players meet",()=>{
  const now=Date.now(),room=pair(now),a=structuredClone(room.members.get("a")!.document);
  const title=fill(a,a.assets.find(emptySymbol)!);
  publishMeeting(room,"a",a,[],true,true,now+100);
  assert.equal(meetingTurn(room,"a",now)!.owner,"a");
  assert.equal(meetingView(room,"b").materials.length,0);
  assert.equal(room.links.length,0);
  advanceMeetingTurns(room,now+TURN_DURATION);
  assert.equal(meetingTurn(room,"b",now+TURN_DURATION)!.owner,"b");
  const gift=meetingView(room,"b").materials.find(a=>a.text===title.text)!;
  assert.ok(gift);assert.equal(gift.prompt,undefined);
  assert.equal(room.links.length,0);
  assert.equal(advanceMeetingTurns(room,now+TURN_DURATION+100),false);
  assert.equal(meetingView(room,"b").materials.length,1);
});

test("each paired turn allows three distinct new tile positions across publishes, erasure and retries", () => {
  const now = Date.now(), room = pair(now);
  const world = structuredClone(room.members.get("a")!.document), tiles = world.terrain!.tiles;
  const publish = (time = now + 1) => publishMeeting(room, "a", world, [], false, true, time);
  const added = () => meetingTurn(room, "a")!.tiles!.added;
  for (const i of [0, 1, 2, 3]) tiles[i] = { height: 0, surface: "plain" };
  assert.throws(() => publish(), {message: TURN_TILE_HINT});
  assert.deepEqual(added(), []);
  tiles[3].void = true;
  publish(); publish();
  assert.deepEqual(added(), [0,1,2]);
  assert.equal(meetingTurn(room, "b")?.tiles, undefined);
  tiles[0].void = true;
  publish();
  tiles[3].void = false;
  assert.throws(() => publish(), {message: TURN_TILE_HINT});
  tiles[3].void = true;
  tiles[0].void = false;
  tiles[1].surface = "rough";
  tiles[world.start.z * world.size + world.start.x].height++;
  publish();
  assert.deepEqual(added(), [0,1,2]);
  advanceMeetingTurns(room, now + TURN_DURATION);
  assert.deepEqual(meetingTurn(room, "b")!.tiles!.added, []);
  advanceMeetingTurns(room, now + 2 * TURN_DURATION);
  tiles[3].void = false;
  publish(now + 2 * TURN_DURATION + 1);
  assert.deepEqual(added(), [3]);
});

test("opening a world ends both turns and permits terrain, placement, movement and deletion immediately",()=>{
  const now=Date.now(),room=pair(now),gate=buildConnection(room,now);
  assert.ok(gate);
  assert.equal(meetingTurn(room,"a",now)!.owner,"b");
  assert.equal(meetingTurn(room,"b",now)!.owner,"b");
  const blocked=structuredClone(room.members.get("a")!.document);
  blocked.terrain!.tiles[0]={height:0,surface:"soft"};
  assert.throws(()=>publishMeeting(room,"a",blocked,[],false,true,now+TURN_DURATION+2),{message:TURN_HINT});
  crossConnection(room,gate);
  assert.equal(room.links.length,1);
  assert.equal(meetingTurn(room,"a",now),undefined);
  assert.equal(meetingTurn(room,"b",now),undefined);
  assert.deepEqual(meetingView(room,"a").recipients,["b"]);
  assert.deepEqual(meetingView(room,"b").recipients,["a"]);
  assert.equal(meetingView(room,"b").connections[0].online,true);
  assert.equal(meetingView(room,"b").connections[0].opened,true);
  assert.deepEqual(meetingView(room,"a").materials.map(a=>a.text),["world b"]);
  const frozen=structuredClone(room.turns);
  assert.equal(advanceMeetingTurns(room,now+10*TURN_DURATION),false);
  assert.deepEqual(room.turns,frozen);
  for(const id of ["a","b"]){
    const world=structuredClone(room.members.get(id)!.document);
    world.terrain!.tiles[0]={height:0,surface:"soft"};
    world.objects.push({...world.objects[0],id:`copy-${id}`,x:0,z:0});
    assert.doesNotThrow(()=>publishMeeting(room,id,world,[],false,true,now+10*TURN_DURATION));
    world.objects.at(-1)!.x=1;
    assert.doesNotThrow(()=>publishMeeting(room,id,world,[],false,true,now+10*TURN_DURATION+1));
    world.objects.pop();world.terrain!.tiles[0]={height:0,surface:"plain",void:true};
    assert.doesNotThrow(()=>publishMeeting(room,id,world,[],false,true,now+10*TURN_DURATION+2));
    assert.deepEqual(room.members.get(id)!.document.objects,world.objects);
  }
});

test("connected creators share completed placed originals without waiting or forwarding copies and drafts",()=>{
  const now=Date.now(),room=pair(now);
  crossConnection(room,buildConnection(room,now));
  for(const [id,peer] of [["a","b"],["b","a"]]){
    const world=structuredClone(room.members.get(id)!.document);
    const own=fill(world,world.assets.find(emptySymbol)!);
    world.assets.push({...own,id:`unplaced-${id}`});
    publishMeeting(room,id,world,[],false,true,now+TURN_DURATION+2);
    const gifts=meetingView(room,peer).materials;
    assert.equal(gifts.length,2);
    assert.ok(gifts.some(a=>a.id===`received-${own.id}`));
    assert.ok(gifts.every(a=>!a.prompt&&!a.id.includes("unplaced")&&!a.id.startsWith("received-received-")));
    assert.ok(world.assets.some(emptySymbol));
  }
});

test("a connected pair stays free on reconnect while other and newly matched pairs still take turns",()=>{
  const now=Date.now(),room=pair(now),gate=buildConnection(room,now);
  for(const id of ["c","d"]){
    addMeetingMember(room,id,now+TURN_DURATION+2);
    publishMeeting(room,id,room.members.get(id)!.document,[],false,true,now+TURN_DURATION+2);
  }
  const cd=meetingTurn(room,"c",now)!;
  crossConnection(room,gate);
  assert.deepEqual(meetingTurn(room,"c",now),cd);
  advanceMeetingTurns(room,cd.endsAt);
  assert.equal(meetingTurn(room,"a",now),undefined);
  assert.equal(meetingTurn(room,"d",now)!.owner,"d");
  disconnectMeetingMember(room,"b",cd.endsAt+1);
  assert.deepEqual(meetingView(room,"a").recipients,[]);
  const alone=structuredClone(room.members.get("a")!.document);
  const image=fill(alone,alone.assets.find(emptySymbol)!);
  publishMeeting(room,"a",alone,[],false,true,cd.endsAt+2);
  assert.ok(!meetingView(room,"b").materials.some(a=>a.id===`received-${image.id}`));
  addMeetingMember(room,"b",cd.endsAt+3);
  assert.equal(meetingTurn(room,"a",now),undefined);
  assert.equal(meetingTurn(room,"b",now),undefined);
  assert.deepEqual(meetingView(room,"a").recipients,["b"]);
  assert.equal(meetingView(room,"b").connections[0].id,gate.id);
  assert.ok(meetingView(room,"b").materials.some(a=>a.id===`received-${image.id}`));
  disconnectMeetingMember(room,"b",cd.endsAt+4);
  addMeetingMember(room,"e",cd.endsAt+5);
  publishMeeting(room,"e",room.members.get("e")!.document,[],false,true,cd.endsAt+5);
  assert.equal(meetingTurn(room,"a",now)!.partner,"e");
  assert.equal(meetingTurn(room,"e",now)!.owner,"a");
  assert.deepEqual(meetingView(room,"e").materials,[]);
  assert.equal(meetingTurn(room,"c",now)!.partner,"d");
});

test("a third creator has no turn or sharing until a fourth arrives, then shares only with that partner",()=>{
  const now=Date.now(),room=pair(now);
  addMeetingMember(room,"c",now+10);
  for(const id of ["a","b","c"]){
    const world=structuredClone(room.members.get(id)!.document);
    fill(world,world.assets.find(emptySymbol)!,`created by ${id}`);
    if(id==="c")world.assets.push({...world.assets[0],id:"unplaced-draft",text:"unplaced"});
    publishMeeting(room,id,world,[],true,true,now+20);
  }
  assert.equal(meetingTurn(room,"c",now),undefined);
  assert.deepEqual(meetingView(room,"c").recipients,[]);
  advanceMeetingTurns(room,now+2*TURN_DURATION);
  assert.deepEqual(meetingView(room,"a").materials.map(a=>a.text),["created by b"]);
  assert.deepEqual(meetingView(room,"b").materials.map(a=>a.text),["created by a"]);
  assert.deepEqual(meetingView(room,"c").materials,[]);
  assert.deepEqual(room.members.get("c")!.published,[]);
  const ab=meetingTurn(room,"a",now)!;
  const joined=now+2*TURN_DURATION+100;
  addMeetingMember(room,"d",joined);
  publishMeeting(room,"d",room.members.get("d")!.document,[],false,true,joined);
  assert.deepEqual(meetingTurn(room,"a",now),ab);
  assert.equal(meetingTurn(room,"c",joined)!.partner,"d");
  assert.deepEqual(meetingView(room,"c").recipients,["d"]);
  assert.deepEqual(meetingView(room,"d").materials,[]);
  advanceMeetingTurns(room,joined+TURN_DURATION);
  assert.deepEqual(meetingView(room,"d").materials.map(a=>a.text),["created by c"]);
  assert.equal(meetingView(room,"d").materials[0].prompt,undefined);
  assert.deepEqual(meetingView(room,"c").materials,[]);
  assert.deepEqual(meetingView(room,"b").materials.map(a=>a.text),["created by a"]);
});

test("losing a partner stops turns and sharing, and a new partner waits for the next turn's current work",()=>{
  const now=Date.now(),room=pair(now),world=structuredClone(room.members.get("a")!.document);
  const title=fill(world,world.assets.find(emptySymbol)!,"old paired version");
  publishMeeting(room,"a",world,[],true,true,now+10);
  advanceMeetingTurns(room,now+TURN_DURATION);
  disconnectMeetingMember(room,"b",now+TURN_DURATION+1);
  assert.equal(meetingTurn(room,"a",now),undefined);
  assert.deepEqual(room.members.get("a")!.published,[]);
  fill(world,world.assets.find(a=>a.id===title.id)!,"made while alone");
  publishMeeting(room,"a",world,[],true,true,now+TURN_DURATION+2);
  assert.deepEqual(room.members.get("a")!.published,[]);
  assert.deepEqual(meetingView(room,"a").recipients,[]);
  addMeetingMember(room,"c",now+TURN_DURATION+3);
  publishMeeting(room,"c",room.members.get("c")!.document,[],false,true,now+TURN_DURATION+3);
  assert.deepEqual(meetingView(room,"c").materials,[]);
  advanceMeetingTurns(room,meetingTurn(room,"a",now)!.endsAt);
  assert.deepEqual(meetingView(room,"c").materials.map(a=>a.text),["made while alone"]);
  assert.deepEqual(meetingView(room,"b").materials.map(a=>a.text),["old paired version"]);
});

test("successive prompt completions can be published together without allowing forged prompts",()=>{
  const before=createMeetingWorld(7),after=structuredClone(before);
  fill(after,after.assets.find(emptySymbol)!);
  fill(after,after.assets.find(a=>emptySymbol(a)&&a.prompt!.kind==="image")!);
  assert.equal(isContentEdit(before,after),true);
  const forged=structuredClone(after);
  forged.assets.find(a=>emptySymbol(a)&&a.prompt!.kind==="sound")!.prompt!.kind="image";
  assert.equal(isContentEdit(before,forged),false);
});

test("server rejects placement outside the turn while accepting title editing and replenishment",()=>{
  const now=Date.now(),room=pair(now),b=structuredClone(room.members.get("b")!.document);
  fill(b,b.assets.find(emptySymbol)!);
  assert.doesNotThrow(()=>publishMeeting(room,"b",b,[],false,true,now+10));
  const changed=structuredClone(b);changed.terrain!.tiles[0]={height:0,surface:"plain"};
  assert.throws(()=>publishMeeting(room,"b",changed,[],false,true,now+20),{message:TURN_HINT});
  assert.deepEqual(room.members.get("b")!.document.terrain,b.terrain);
  assert.doesNotThrow(()=>publishMeeting(room,"b",changed,[],false,true,now+TURN_DURATION));
});

test("pairs have independent turns, joining does not restart an existing minute, and disconnect unlocks the survivor",()=>{
  const now=Date.now(),room=pair(now),end=meetingTurn(room,"a",now)!.endsAt;
  for(const id of ["c","d"]){addMeetingMember(room,id,now+100);publishMeeting(room,id,structuredClone(room.members.get(id)!.document),[],false,true,now+100);}
  assert.equal(meetingTurn(room,"a",now)!.endsAt,end);
  assert.equal(meetingTurn(room,"c",now)!.owner,"c");
  disconnectMeetingMember(room,"d",now+200);
  assert.equal(meetingTurn(room,"c",now),undefined);
  assert.equal(meetingTurn(room,"a",now)!.endsAt,end);
});

test("malformed prompt metadata and refill queues are rejected on import",()=>{
  const w=createMeetingWorld(6);
  (w.assets.find(emptySymbol)!.prompt as any).kind="unknown";
  assert.throws(()=>validateWorld(w,MAX_LIBRARY_SIZE));
  const other=createMeetingWorld(6);other.workshop!.pending=[{kind:"image",x:-1,z:0}];
  assert.throws(()=>validateWorld(other,MAX_LIBRARY_SIZE));
});

test("disconnecting another pair preserves a pair's partner, owner and remaining minute",()=>{
  const now=Date.now(),room=pair(now);
  for(const id of ["c","d"]){addMeetingMember(room,id,now+100);publishMeeting(room,id,structuredClone(room.members.get(id)!.document),[],false,true,now+100);}
  const original=meetingTurn(room,"c",now+100)!;
  disconnectMeetingMember(room,"a",now+1000);
  assert.deepEqual(meetingTurn(room,"c",now+1000),{...original,serverNow:now+1000});
  assert.equal(meetingTurn(room,"b",now+1000),undefined);
  addMeetingMember(room,"a",now+2000);advanceMeetingTurns(room,now+2000);
  assert.equal(meetingTurn(room,"b",now+2000)!.partner,"a");
  assert.deepEqual(meetingTurn(room,"c",now+2000),{...original,serverNow:now+2000});
});

test("content validation leaves the original world and refill queue untouched",()=>{
  const before=createMeetingWorld(9),snapshot=structuredClone(before),after=structuredClone(before);
  fill(after,after.assets.find(emptySymbol)!);
  assert.equal(isContentEdit(before,after),true);
  assert.deepEqual(before,snapshot);
  const invalid=structuredClone(after);invalid.objects[0].z--;
  assert.equal(isContentEdit(before,invalid),false);
  assert.deepEqual(before,snapshot);
});
