import { validateWorld, type Asset, type ConnectionFooting, type Player, type World } from "./world.ts";
import { contentKind, MAX_LIBRARY_SIZE } from "./content-limits.ts";
import { createTerrainWorld } from "./create-world.ts";
import { flatTerrain, floorHeight, deriveStructures, randomSequence, type Structure, type Tile } from "./terrain.ts";
import { isGap } from "./tile.ts";
import { initializeWorkshop, isContentEdit, TURN_HINT } from "./workshop.ts";
import { advanceMeteors, createMeteorTimeline, type MeteorTimeline } from "./meteors.ts";

export const LOCAL_SIZE = 12;
export const MEETING_SIZE = LOCAL_SIZE * 3 + 2;
export const MEETING_START = { x: 6, z: 10 } as const;
export const MEETING_RECONNECT_MS = 60_000;
export const MEETING_MATERIAL_LIMIT = 6;
export const MEETING_LEMON = "#f3ef91";
export const MEETING_MATERIAL_MESSAGE = "기호는 이미지·텍스트·소리를 합쳐 6종까지 만들 수 있습니다.";
export const MEETING_PATH = "/whistle/meeting";
export const TURN_DURATION = 60_000;
export type MeetingTurn = { owner: string; partner: string; startedAt: number; endsAt: number; serverNow: number };
type TurnPair = { members: [string, string]; owner: string; startedAt: number; endsAt: number };
// Every viewer keeps their own map in the centre; only the two adjacent maps are rendered.
export const MEETING_REGIONS = [
  { x0: 13, x1: 24, z0: 0, z1: 11 },
  { x0: 0, x1: 11, z0: 0, z1: 11 },
  { x0: 26, x1: 37, z0: 0, z1: 11 },
] as const;
export type MeetingPosition = Player & { grounded: boolean };
export type MeetingSignal = { id: string; from: string; to: string; x: number; z: number; collected: boolean };
export type ConnectionTile = { id: string; members: [string, string]; x: number; z: number; cells?: {x:number;z:number}[]; opened?: boolean; online?: boolean; retired?: boolean; built?: boolean };
export type MeetingPeer = { id: string; slot: number; online: boolean; playing: boolean; player?: MeetingPosition };
export type MeetingPresence = { peers: MeetingPeer[]; canWhistle: boolean; onlineCount?: number; turn?: MeetingTurn;
  meteors?: { timeline: MeteorTimeline; now: number } };
type MeetingReset = { id:number; player:MeetingPosition; reason?:"disconnect"|"floor" };
export type MeetingView = {
  id: string; slot: number; revision: number; world: World;
  signals: MeetingSignal[]; connections: ConnectionTile[]; approaches: ConnectionTile[]; joined: string[];
  ownWorld: World; recipients: string[];
  materials: Asset[]; received: string[]; pendingMaterials: number;
  reset: MeetingReset;
  documentReady: boolean;
};
export type MeetingWhistle = { id: string; from: string; x: number; z: number };
export type MeetingMessage =
  | { type: "state"; view: MeetingView; presence: MeetingPresence }
  | { type: "presence"; presence: MeetingPresence }
  | { type: "whistle"; whistle: MeetingWhistle }
  | { type: "error"; message: string; world?: World };
type NeighborSlot = { peer: string; key: string; row: number; active: boolean; used: boolean };
type Member = MeetingPeer & {
  player: MeetingPosition; document: World; revision: number; leftAt?: number;
  reset: MeetingReset;
  ready: boolean;
  ports: [NeighborSlot | null, NeighborSlot | null];
  materials: Map<string, Asset>; received: Set<string>; shared: Map<string, string>; published: Asset[];
  lastWhistle: number; resumeKey?: string;
  nightSky?: boolean;
};
export type MeetingRoom = {
  members: Map<string, Member>; chain: string[]; signals: MeetingSignal[]; connections: ConnectionTile[];
  links: [viewer:string,target:string][]; revision: number; seed: number; sequence: number;
  turns: TurnPair[];
  meteors: MeteorTimeline;
};
const emptyTile = (): Tile => ({ height: 0, surface: "plain", void: true });
export function fixMeetingStart(world: World) {
  world.start = { ...MEETING_START };
  if (world.terrain && isGap(world.terrain.tiles[MEETING_START.z * LOCAL_SIZE + MEETING_START.x]))
    world.terrain.tiles[MEETING_START.z * LOCAL_SIZE + MEETING_START.x] = {height:0,surface:"plain"};
  return world;
}
export function createMeetingWorld(seed?: number): World {
  return initializeWorkshop(fixMeetingStart(createTerrainWorld(seed)));
}
export function meetingLocal(slot: number, p: {x:number;z:number}) {
  const r=MEETING_REGIONS[slot]; return {x:p.x-r.x0,z:p.z-r.z0};
}
export function meetingGlobal(slot: number, p: {x:number;z:number}) {
  const r=MEETING_REGIONS[slot]; return {x:p.x+r.x0,z:p.z+r.z0};
}
export const meetingCell = (x:number,z:number) => z * MEETING_SIZE + x;
export function meetingOwner(x:number,z:number) {
  return MEETING_REGIONS.findIndex(r=>x>=r.x0&&x<=r.x1&&z>=r.z0&&z<=r.z1);
}
export function connectionCandidates(a:number,b:number) {
  if (a!==0 && b!==0) return [];
  const other=a===0?b:a;
  return other===1||other===2?Array.from({length:5},(_,z)=>({x:other===1?12:25,z})):[];
}
export function connectionCells(connection:ConnectionTile) { return connection.cells ?? [connection]; }
const portPoint = (index:number,row:number) => ({x:index===0?12:25,z:row});
const footingPoint = (footing:ConnectionFooting) => portPoint(footing.side,footing.row);
function returningToOwnWorld(member:Member) {
  if(!member.ports.some(p=>p?.used&&!p.active&&member.document.connectionFootings?.some(f=>f.id===p.key&&f.built)))return false;
  if(!member.player.grounded||meetingOwner(Math.round(member.player.x),Math.round(member.player.z))!==0)return true;
  const local=meetingLocal(0,member.player);
  return !supported(member.document,local.x,local.z);
}
function assignPort(room:MeetingRoom,member:Member,peer:Member,side:0|1,row:number) {
  const key=`connection-${room.seed.toString(36)}-${++room.sequence}`;
  member.ports=[null,null];
  member.ports[side]={peer:peer.id,key,row,active:true,used:false};
  member.revision++;
}
export function meetingNeighbors(room:MeetingRoom,id:string) {
  const i=room.chain.indexOf(id); return i<0?[]:[room.chain[i-1],room.chain[i+1]].filter((id):id is string=>!!id);
}
export function createMeetingRoom(seed=Math.floor(Math.random()*0xffffffff)):MeetingRoom {
  return {members:new Map(),chain:[],signals:[],connections:[],links:[],revision:0,seed,sequence:0,turns:[],meteors:createMeteorTimeline(seed)};
}
function advanceMeetingMeteors(room: MeetingRoom, now: number) {
  return advanceMeteors(room.meteors, [...room.members.values()].some(m => m.online && m.nightSky), now);
}
export function setMeetingNightSky(room: MeetingRoom, id: string, eligible: boolean, now = Date.now()) {
  const member = room.members.get(id);
  if (!member) return false;
  member.nightSky = eligible;
  return advanceMeetingMeteors(room, now);
}
function connectedPair(room: MeetingRoom, pair: TurnPair) {
  const [a,b]=pair.members;
  return room.links.some(([from,to])=>from===a&&to===b||from===b&&to===a);
}
export function meetingPartner(room: MeetingRoom, id: string) {
  return room.turns.find(pair=>pair.members.includes(id))?.members.find(member=>member!==id);
}
export function advanceMeetingTurns(room: MeetingRoom, now = Date.now()) {
  const ready = room.chain.filter(id => { const m = room.members.get(id); return m?.online && m.ready; });
  const readyIds = new Set(ready);
  const turns = room.turns.filter(pair => pair.members.every(id => readyIds.has(id)));
  let changed = turns.length !== room.turns.length;
  for (const pair of turns) {
    if (connectedPair(room,pair) || now < pair.endsAt) continue;
    const elapsed = Math.floor((now - pair.endsAt) / TURN_DURATION) + 1;
    for (const id of elapsed > 1 ? pair.members : [pair.owner]) {
      const member = room.members.get(id);
      if (member) snapshotMaterials(member);
    }
    if (elapsed % 2) pair.owner = pair.members.find(id => id !== pair.owner)!;
    pair.startedAt = pair.endsAt + (elapsed - 1) * TURN_DURATION;
    pair.endsAt += elapsed * TURN_DURATION;
    changed = true;
  }
  const paired = new Set(turns.flatMap(pair => pair.members));
  for (const member of room.members.values()) if (!paired.has(member.id)) member.published = [];
  const waiting = ready.filter(id => !paired.has(id));
  for (let i = 0; i + 1 < waiting.length; i += 2) {
    const a = waiting[i], b = waiting[i + 1];
    const pair: TurnPair = { members: [a, b], owner: a, startedAt: now, endsAt: now + TURN_DURATION };
    turns.push(pair);
    if (connectedPair(room,pair)) for (const id of pair.members) snapshotMaterials(room.members.get(id)!);
    changed = true;
  }
  room.turns = turns;
  if (changed) { room.revision++; syncNeighborSlots(room); shareMeetingMaterials(room); discoverMeetingConnections(room); }
  return changed;
}
export function meetingTurn(room: MeetingRoom, id: string, now = Date.now()): MeetingTurn | undefined {
  const pair = room.turns.find(p => p.members.includes(id));
  if (!pair || connectedPair(room,pair)) return;
  return { owner: pair.owner, partner: pair.members.find(member => member !== id)!,
    startedAt: pair.startedAt, endsAt: pair.endsAt, serverNow: now };
}
function syncConnections(room:MeetingRoom) {
  room.connections=[...room.members.values()].flatMap(m=>m.ports.flatMap((p,i)=>p?.used&&m.document.connectionFootings?.some(f=>f.id===p.key)?
    [{id:p.key,members:[m.id,p.peer] as [string,string],...portPoint(i,p.row)}]:[]));
}
function syncNeighborSlots(room:MeetingRoom) {
  let changed=false;
  for (const member of room.members.values()) {
    const partner=meetingPartner(room,member.id);
    const desired=partner?(room.chain.indexOf(partner)<room.chain.indexOf(member.id)?[partner,undefined]:[undefined,partner]):[];
    member.ports.forEach((port,i)=>{
      const peer=desired[i];
      if (port && port.peer===peer) {
        if(!port.active){port.active=true;changed=true;}
        return;
      }
      if (!peer) {
        if(port?.active){port.active=false;changed=true;}
        return;
      }
      if (port) room.links=room.links.filter(([a,b])=>a!==member.id||b!==port.peer);
      if(port?.active){port.active=false;changed=true;}
    });
  }
  for(const pair of room.turns){
    const [first,second]=[...pair.members].sort((a,b)=>room.chain.indexOf(a)-room.chain.indexOf(b));
    const a=room.members.get(first)!,b=room.members.get(second)!;
    if(!a.ready||!b.ready)continue;
    if(a.ports[1]?.active&&a.ports[1].peer===b.id&&b.ports[0]?.active&&b.ports[0].peer===a.id)continue;
    if(returningToOwnWorld(a)||returningToOwnWorld(b))continue;
    const candidates=connectionCandidates(0,2).map(p=>p.z);
    const history=(member:Member,side:number,row:number)=>member.document.connectionFootings?.find(p=>p.side===side&&p.row===row);
    const free=candidates.filter(row=>!history(a,1,row)&&!history(b,0,row));
    const rows=free.length?free:candidates.filter(row=>{
      const age=(z:number)=>Math.max(history(a,1,z)?.created??0,history(b,0,z)?.created??0);
      return age(row)===Math.min(...candidates.map(age));
    });
    const row=rows[Math.floor(randomSequence((room.seed+room.sequence)>>>0)()*rows.length)];
    assignPort(room,a,b,1,row);assignPort(room,b,a,0,row);changed=true;
  }
  for(const member of room.members.values()){
    const active=member.ports.some(p=>p?.active),returning=!active&&returningToOwnWorld(member);
    const footings=member.ports.flatMap((p,side)=>p&&(p.active||returning&&p.used)?[{
      id:p.key,side:side as 0|1,row:p.row,built:p.used,
      created:member.document.connectionFootings?.find(f=>f.id===p.key)?.created??Date.now(),
    }]:[]).slice(0,1);
    if(JSON.stringify(member.document.connectionFootings??[])!==JSON.stringify(footings)){
      member.document={...member.document,connectionFootings:footings};member.revision++;changed=true;
    }
  }
  if(changed){syncConnections(room);room.revision++;}
  return changed;
}
export function reconcileMeeting(room:MeetingRoom,now=Date.now(),graceMs=MEETING_RECONNECT_MS) {
  const chain=room.chain.filter(id=>{const m=room.members.get(id)!;return m.online || now-(m.leftAt??now)<graceMs;});
  let changed=chain.length!==room.chain.length;
  if(changed){
    room.chain=chain;room.revision++;
    for(const [id,member] of room.members)if(!member.online&&!chain.includes(id)) {
      room.members.delete(id);
      worldCache.get(room)?.delete(id);
      room.links=room.links.filter(([from,to])=>from!==id&&to!==id);
    }
  }
  changed=syncNeighborSlots(room)||changed;
  changed=advanceMeetingTurns(room,now)||changed;
  changed=advanceMeetingMeteors(room,now)||changed;
  if(changed){shareMeetingMaterials(room);discoverMeetingConnections(room);}
  return changed;
}
export function disconnectMeetingMember(room:MeetingRoom,id:string,now=Date.now()) {
  const m=room.members.get(id);if(!m)return;
  for(const visitor of room.members.values()) {
    const occupied=layout(room,visitor.id).find(r=>r.slot===meetingOwner(Math.round(visitor.player.x),Math.round(visitor.player.z)));
    if(occupied && (occupied.id===id&&visitor.id!==id || visitor.id===id&&occupied.id!==id)) {
      const port=visitor.ports.findIndex(p=>!!p&&p.peer===occupied?.id&&p.used);
      relocateMeeting(room,visitor,port<0?meetingGlobal(0,MEETING_START):portPoint(port,visitor.ports[port]!.row),"disconnect");
    }
  }
  m.online=false;m.playing=false;m.leftAt=now;room.revision++;
  m.nightSky=false;advanceMeetingMeteors(room,now);
  advanceMeetingTurns(room,now);
}
export function leaveMeetingMember(room:MeetingRoom,id:string) {
  disconnectMeetingMember(room,id);
  room.chain=room.chain.filter(member=>member!==id);
  room.links=room.links.filter(([from,to])=>from!==id&&to!==id);
  room.members.delete(id);
  worldCache.get(room)?.delete(id);
  room.revision++;
  syncNeighborSlots(room);shareMeetingMaterials(room);discoverMeetingConnections(room);
}
function relocateMeeting(room:MeetingRoom,member:Member,point:{x:number;z:number},reason:MeetingReset["reason"]) {
  member.player=meetingReturnPosition(point,member.player.yaw,reason);
  member.reset={id:member.reset.id+1,player:{...member.player},reason};room.revision++;
}
export function meetingReturnPosition(point:{x:number;z:number},yaw:number,reason:MeetingReset["reason"]):MeetingPosition {
  return {...point,yaw:reason==="disconnect"?(point.x<13?Math.PI/2:-Math.PI/2):yaw,pitch:-.7,grounded:true,falling:false};
}
export function addMeetingMember(room:MeetingRoom,id:string,now=Date.now()) {
  reconcileMeeting(room,now);
  let member=room.members.get(id);
  if(!member){
    const document=createMeetingWorld((room.seed+Math.imul(room.members.size,0x9e3779b9))>>>0);
    member={id,slot:0,online:true,playing:false,document,revision:0,ready:false,ports:[null,null],
      reset:{id:0,player:{...meetingGlobal(0,MEETING_START),yaw:0,grounded:true}},
      player:{...meetingGlobal(0,MEETING_START),yaw:0,grounded:true},materials:new Map(),received:new Set(),shared:new Map(),published:[],lastWhistle:-Infinity};
    room.members.set(id,member);
  }
  member.online=true;delete member.leftAt;
  if(!room.chain.includes(id))room.chain.push(id);
  advanceMeetingTurns(room,now);
  room.revision++;syncNeighborSlots(room);shareMeetingMaterials(room);discoverMeetingConnections(room);
  const occupied=meetingOwner(Math.round(member.player.x),Math.round(member.player.z));
  if(occupied>0&&!layout(room,id).some(r=>r.slot===occupied))
    relocateMeeting(room,member,member.ports[occupied-1]?portPoint(occupied-1,member.ports[occupied-1]!.row):meetingGlobal(0,MEETING_START),"disconnect");
  return member;
}
export function meetingVisibleMembers(room:MeetingRoom,id:string) {
  const m=room.members.get(id)!;
  return new Set([id,...room.links.filter(([a,b])=>a===id&&room.members.get(b)?.online&&m.ports.some(p=>p?.peer===b&&p.active)).map(([,b])=>b)]);
}
function layout(room:MeetingRoom,id:string) {
  const m=room.members.get(id)!,visible=meetingVisibleMembers(room,id);
  return [{id,slot:0},...m.ports.flatMap((p,i)=>p&&visible.has(p.peer)?[{id:p.peer,slot:i+1}]:[])];
}
const worldCache=new WeakMap<MeetingRoom,Map<string,{key:string;world:World}>>();
export function meetingWorld(room:MeetingRoom,id:string):World {
  let cache=worldCache.get(room);if(!cache){cache=new Map();worldCache.set(room,cache);}
  const member=room.members.get(id)!,regions=layout(room,id);
  const key=JSON.stringify([regions.map(p=>[p.id,p.slot,room.members.get(p.id)!.revision]),member.ports]);
  const cached=cache.get(id);if(cached?.key===key)return cached.world;
  const terrain=flatTerrain(MEETING_SIZE);terrain.seed=room.seed;terrain.floating=true;
  terrain.tiles=Array.from({length:MEETING_SIZE**2},emptyTile);
  const assets:World["assets"]=[],objects:World["objects"]=[],rules:World["rules"]=[];
  for(const region of regions){
    const peer=room.members.get(region.id)!,prefix=(s:string)=>`${peer.id}:${s}`;
    (peer.document.terrain?.tiles??flatTerrain(LOCAL_SIZE).tiles).forEach((tile,i)=>{
      const p=meetingGlobal(region.slot,{x:i%LOCAL_SIZE,z:Math.floor(i/LOCAL_SIZE)});terrain.tiles[meetingCell(p.x,p.z)]={...tile};
    });
    assets.push(...peer.document.assets.map(a=>({...a,id:prefix(a.id)})));
    objects.push(...peer.document.objects.map(o=>({...o,id:prefix(o.id),asset:prefix(o.asset),...meetingGlobal(region.slot,o),
      ...(o.site?{site:{...o.site,cells:o.site.cells.map(i=>{const p=meetingGlobal(region.slot,{x:i%LOCAL_SIZE,z:Math.floor(i/LOCAL_SIZE)});return meetingCell(p.x,p.z);})}}:{})})));
    rules.push(...peer.document.rules.map(r=>({...r,id:prefix(r.id),subject:r.subject==="*"?"*":prefix(r.subject),source:r.source==="*"?"*":prefix(r.source),replacement:prefix(r.replacement)})));
  }
  for(const p of member.document.connectionFootings??[])if(p.built){const cell=footingPoint(p);terrain.tiles[meetingCell(cell.x,cell.z)]={height:0,surface:"plain"};}
  const world={...member.document,size:MEETING_SIZE,assets,objects,rules,start:meetingGlobal(0,MEETING_START),terrain};
  cache.set(id,{key,world});return world;
}
export function offlineMeetingWorld(view:MeetingView):World {
  const own=(id:string)=>id.startsWith(`${view.id}:`),world=view.world;
  const pads=new Set([...view.connections,...view.approaches].map(c=>meetingCell(c.x,c.z)));
  return {...world,assets:world.assets.filter(a=>own(a.id)),objects:world.objects.filter(o=>own(o.id)),rules:world.rules.filter(r=>own(r.id)),
    terrain:{...world.terrain!,tiles:world.terrain!.tiles.map((tile,i)=>meetingOwner(i%MEETING_SIZE,Math.floor(i/MEETING_SIZE))===0||pads.has(i)?tile:emptyTile())}};
}
export function localMeetingView(id:string,document=createMeetingWorld()):MeetingView {
  const room=createMeetingRoom(document.terrain?.seed);
  const member=addMeetingMember(room,id);member.document={...document,connectionFootings:[]};member.ready=true;
  return meetingView(room,id);
}
export function withLocalMeetingWorld(view:MeetingView,document:World,online:boolean):World {
  const world=online?view.world:offlineMeetingWorld(view),prefix=(id:string)=>`${view.id}:${id}`;
  const other=(item:{id:string})=>!item.id.startsWith(`${view.id}:`);
  const tiles=[...world.terrain!.tiles];
  (document.terrain?.tiles??flatTerrain(LOCAL_SIZE).tiles).forEach((tile,i)=>{
    const p=meetingGlobal(0,{x:i%LOCAL_SIZE,z:Math.floor(i/LOCAL_SIZE)});
    tiles[meetingCell(p.x,p.z)]=tile;
  });
  return {...world,title:document.title,description:document.description,sky:document.sky,weather:document.weather,timeOfDay:document.timeOfDay,
    terrain:{...world.terrain!,tiles},
    assets:[...world.assets.filter(other),...document.assets.map(a=>({...a,id:prefix(a.id)}))],
    objects:[...world.objects.filter(other),...document.objects.map(o=>({...o,id:prefix(o.id),asset:prefix(o.asset),...meetingGlobal(0,o),
      ...(o.site?{site:{...o.site,cells:o.site.cells.map(i=>{const p=meetingGlobal(0,{x:i%LOCAL_SIZE,z:Math.floor(i/LOCAL_SIZE)});return meetingCell(p.x,p.z);})}}:{})}))],
    rules:[...world.rules.filter(other),...document.rules.map(r=>({...r,id:prefix(r.id),subject:r.subject==="*"?"*":prefix(r.subject),source:r.source==="*"?"*":prefix(r.source),replacement:prefix(r.replacement)}))]};
}
export function authoredMaterialCount(world:World,received:ReadonlySet<string>) {
  return world.assets.filter(a=>contentKind(a)&&!a.received&&!received.has(a.id)).length;
}
function snapshotMaterials(member: Member) {
  const placed = new Set(member.document.objects.map(o => o.asset));
  member.published = member.document.assets.filter(a => placed.has(a.id) && contentKind(a) && !a.received && !member.materials.has(a.id))
    .map(({ prompt: _, ...asset }) => structuredClone(asset));
}
function shareMeetingMaterials(room:MeetingRoom) {
  for(const pair of room.turns)for(const id of pair.members){
    const source=room.members.get(id)!,recipient=room.members.get(pair.members.find(peer=>peer!==id)!)!;
    if(!source.online||!recipient.online||!source.ready||!recipient.ready)continue;
    for(const asset of source.published){
      if(!contentKind(asset)||asset.received||source.materials.has(asset.id))continue;
      let sharedId=source.shared.get(asset.id);
      if(!sharedId){sharedId=`received-${asset.id}`;source.shared.set(asset.id,sharedId);}
      if(recipient.materials.has(sharedId))continue;
      const {originalImage:_,...copy}=asset;
      recipient.materials.set(sharedId,{...copy,id:sharedId,received:true,...(copy.sound?{sound:{...copy.sound}}:{})});
    }
  }
}
export function discoverMeetingConnections(room:MeetingRoom) {
  let changed=false;
  for(const member of room.members.values())for(const port of member.ports){
    if(!port?.active||port.used)continue;
    const source=room.members.get(port.peer)!;
    const originals=new Set(source.shared.values());
    if(member.document.objects.some(o=>member.materials.has(o.asset)&&originals.has(o.asset))){
      port.used=true;changed=true;
      member.document={...member.document,connectionFootings:member.document.connectionFootings?.map(p=>p.id===port.key?{...p,built:true}:p)};
      member.revision++;
    }
  }
  if(changed){syncConnections(room);room.revision++;}
}
export function publishMeeting(room:MeetingRoom,id:string,input:unknown,received:string[]=[],_legacyShare=false,enforceTurn=false,now=Date.now()) {
  const world=validateWorld(input,MAX_LIBRARY_SIZE);
  if(world.size!==LOCAL_SIZE)throw Error("연결된 세계에서는 12×12 맵을 사용합니다.");
  if(world.start.x!==MEETING_START.x||world.start.z!==MEETING_START.z)throw Error("연결된 세계의 출발점은 고정되어 있습니다.");
  const member=room.members.get(id)!;
  const turnChanged=advanceMeetingTurns(room,now);
  const turn=meetingTurn(room,id,now);
  if(enforceTurn && member.ready && turn && turn.owner!==id && !isContentEdit(member.document,world)) throw Error(TURN_HINT);
  if(member.document.connectionFootings)world.connectionFootings=member.document.connectionFootings.map(p=>({...p}));
  else delete world.connectionFootings;
  if(authoredMaterialCount(world,new Set(member.materials.keys()))>MEETING_MATERIAL_LIMIT)throw Error(MEETING_MATERIAL_MESSAGE);
  if(JSON.stringify(world).length>32*1024*1024)throw Error("공유할 재료의 전체 용량이 너무 큽니다.");
  let acknowledged=false;
  for(const assetId of new Set([...received,...world.receivedMaterialIds??[],...world.assets.filter(a=>a.received).map(a=>a.id)]))if(!member.received.has(assetId)){
    member.received.add(assetId);acknowledged=true;const asset=member.materials.get(assetId);
    if(asset)member.materials.set(assetId,{id:asset.id,name:asset.name,shape:asset.shape,color:asset.color,solid:false,received:true});
  }
  if(member.ready&&JSON.stringify(member.document)===JSON.stringify(world)&&!acknowledged)return turnChanged;
  member.document=world;member.ready=true;member.revision++;room.revision++;
  advanceMeetingTurns(room,now);
  syncNeighborSlots(room);
  const pair=room.turns.find(pair=>pair.members.includes(id));
  if(pair&&connectedPair(room,pair))snapshotMaterials(member);
  shareMeetingMaterials(room);discoverMeetingConnections(room);
  for(const visitor of room.members.values()) {
    if(visitor.id===id||!visitor.playing||!visitor.player.grounded||visitor.player.falling)continue;
    const occupied=layout(room,visitor.id).find(r=>r.id===id&&r.slot===meetingOwner(Math.round(visitor.player.x),Math.round(visitor.player.z)));
    if(!occupied)continue;
    const p=meetingLocal(occupied.slot,visitor.player);
    if(floorHeight(world,p.x,p.z)!==null)continue;
    const port=visitor.ports.findIndex(p=>p?.peer===id&&p.used);
    relocateMeeting(room,visitor,port<0?meetingGlobal(0,MEETING_START):portPoint(port,visitor.ports[port]!.row),"floor");
  }
  return true;
}
function onlinePort(room:MeetingRoom,id:string,p:NeighborSlot) {
  return p.active&&!!room.members.get(id)?.online&&!!room.members.get(p.peer)?.online;
}
export function meetingView(room:MeetingRoom,id:string):MeetingView {
  const member=room.members.get(id)!,group=meetingVisibleMembers(room,id);
  const partner=meetingPartner(room,id);
  let slots=Math.max(0,MAX_LIBRARY_SIZE-member.document.assets.length),bytes=32*1024*1024-JSON.stringify(member.document).length;
  const materials:Asset[]=[];let pendingMaterials=0;
  for(const asset of member.materials.values()){
    if(member.received.has(asset.id)){materials.push(asset);continue;}
    const size=JSON.stringify(asset).length;
    if(slots>0&&bytes>=size){materials.push(asset);slots--;bytes-=size;}else pendingMaterials++;
  }
  const connections:ConnectionTile[]=[],approaches:ConnectionTile[]=[];
  for(const footing of member.document.connectionFootings??[]){
    const p=member.ports.find(p=>p?.key===footing.id);
    const c:ConnectionTile={id:footing.id,members:[id,p?.peer??""],...footingPoint(footing),
      opened:!!p?.active&&group.has(p.peer),online:!!p&&onlinePort(room,id,p),retired:!p?.active,built:footing.built};
    (p?.active?p.used:footing.built)?connections.push(c):approaches.push(c);
  }
  return {id,slot:0,revision:room.revision,world:meetingWorld(room,id),signals:[],connections,approaches,joined:[...group],
    ownWorld:member.document,materials,pendingMaterials,received:[...member.received],recipients:partner?[partner]:[],reset:member.reset,documentReady:member.ready};
}
// Translate a player's location through the world they occupy, not their viewer's coordinate system.
const structureCache = new WeakMap<World, Structure[]>();
function supported(world:World,x:number,z:number) {
  let structures=structureCache.get(world);
  if(!structures){structures=deriveStructures(world);structureCache.set(world,structures);}
  return floorHeight(world,x,z,structures)!==null;
}
function positionFor(room:MeetingRoom,source:string,viewer:string):MeetingPosition|undefined {
  const member=room.members.get(source)!;
  if(source===viewer)return {...member.player};
  const visible=layout(room,viewer),sourceRegions=layout(room,source);
  const region=meetingOwner(Math.round(member.player.x),Math.round(member.player.z));
  for(const origin of sourceRegions){
    if(region>=0&&origin.slot!==region)continue;
    const target=visible.find(r=>r.id===origin.id);if(!target)continue;
    const p=meetingGlobal(target.slot,meetingLocal(origin.slot,member.player));
    const x=Math.round(p.x),z=Math.round(p.z);
    if(x<0||z<0||x>=MEETING_SIZE||z>=MEETING_SIZE)continue;
    if(!supported(meetingWorld(room,viewer),p.x,p.z))continue;
    return {...member.player,...p};
  }
}
function canWhistleMeeting(room:MeetingRoom,id:string) {
  return room.links.some(([a,b])=>(a===id&&room.members.get(b)?.online)||(b===id&&room.members.get(a)?.online));
}
export function meetingWhistleRecipients(room:MeetingRoom,id:string) {
  return [...room.members.values()].filter(m=>m.online&&m.playing&&!!positionFor(room,id,m.id)).map(m=>m.id);
}
export function whistleForViewer(room:MeetingRoom,whistle:MeetingWhistle,viewer:string) {
  const position=positionFor(room,whistle.from,viewer);return position?{...whistle,x:position.x,z:position.z}:null;
}
export function whistleMeeting(room:MeetingRoom,id:string,now=Date.now()):MeetingWhistle|null {
  const m=room.members.get(id);
  if(!m?.online||!m.playing||now-m.lastWhistle<400||!canWhistleMeeting(room,id))return null;
  m.lastWhistle=now;return {id:`whistle-${++room.sequence}`,from:id,x:m.player.x,z:m.player.z};
}
export function meetingPresence(room:MeetingRoom,id:string):MeetingPresence {
  const related=new Set([id,...meetingNeighbors(room,id),...room.members.get(id)!.ports.flatMap(p=>p?[p.peer]:[])]);
  const peers:MeetingPeer[]=[];
  for(const m of room.members.values()){
    const player=positionFor(room,m.id,id);
    if(related.has(m.id)||m.online&&m.playing&&player)peers.push({id:m.id,slot:0,online:m.online,playing:m.playing,...(player?{player}:{})});
  }
  return {peers,canWhistle:canWhistleMeeting(room,id),onlineCount:[...room.members.values()].filter(m=>m.online).length,turn:meetingTurn(room,id),
    meteors:{timeline:{...room.meteors},now:Date.now()}};
}
export function moveMeeting(room:MeetingRoom,id:string,player:MeetingPosition,playing:boolean,resetId?:number) {
  const member=room.members.get(id)!;
  if(resetId!==undefined&&resetId!==member.reset.id)return false;
  if(![player.x,player.z,player.yaw].every(Number.isFinite)||player.x<-.4||player.z<-.4||player.x>MEETING_SIZE-.6||player.z>MEETING_SIZE-.6)return false;
  const owner=meetingOwner(Math.round(player.x),Math.round(player.z));
  if(owner>=0&&!layout(room,id).some(p=>p.slot===owner))return false;
  if(player.grounded&&!supported(meetingWorld(room,id),player.x,player.z))return false;
  member.playing=playing;member.player={x:player.x,z:player.z,yaw:player.yaw,pitch:player.pitch??0,grounded:player.grounded,falling:!!player.falling};
  let changed=syncNeighborSlots(room);
  if(changed)discoverMeetingConnections(room);
  if(playing&&player.grounded&&!player.falling)member.ports.forEach((p,i)=>{
    if(!p)return;
    const point=portPoint(i,p.row);
    if(p?.used&&onlinePort(room,id,p)&&Math.abs(player.x-point.x)<.42&&Math.abs(player.z-point.z)<.42&&!room.links.some(([a,b])=>a===id&&b===p.peer)){
      const pair=room.turns.find(pair=>pair.members.includes(id)&&pair.members.includes(p.peer));
      const connected=pair&&connectedPair(room,pair);
      room.links.push([id,p.peer]);room.revision++;changed=true;
      if(pair&&!connected){
        for(const member of pair.members)snapshotMaterials(room.members.get(member)!);
        shareMeetingMaterials(room);discoverMeetingConnections(room);
      }
    }
  });
  return changed;
}
