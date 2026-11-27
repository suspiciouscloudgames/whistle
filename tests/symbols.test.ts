import test from "node:test";
import assert from "node:assert/strict";
import {createSymbolSession, syncSymbols, stepSymbols, crossesSymbol, interactionKind, GAZE_SECONDS, WAIT_SECONDS, type SymbolSense} from "../lib/symbol-interactions.ts";
import {starterWorld, createSimulation, type Asset, type Shape} from "../lib/world.ts";

function setup(shape: Shape) {
  const world = starterWorld();
  world.assets = [{id:"a",name:"a",shape,color:"#111",solid:false,image:"data:image/png;base64,AA=="}];
  world.objects = [{id:"first",asset:"a",x:6,z:8,scale:1,rotation:0}];
  const session = createSymbolSession();
  syncSymbols(session,createSimulation(world).actors,world.assets,world.start);
  const sense: SymbolSense = {distance:2,visible:true,aimed:true,sameLevel:true};
  const senses = new Map([["first",sense]]);
  const player = {x:6,z:9,feet:0,grounded:true};
  const tick = (seconds: number, tapped: string | null = null) => {
    for (let i=0;i<Math.ceil(seconds*60);i++) stepSymbols(session,senses,player,1/60,i===0?tapped:null);
  };
  return {world,session,sense,senses,player,tick,state:session.states.get("first")!};
}

test("six symbol shapes and legacy equivalents resolve to six distinct interactions",()=>{
  assert.deepEqual(["sphere","box","cone","diamond","ring","bar"].map(s=>interactionKind(s as Shape)),["approach","touch","gaze","follow","wait","cross"]);
  assert.equal(interactionKind("image"),"approach");
  assert.equal(interactionKind("flower"),"gaze");
});
test("approach reveals progressively and fades again when moving away",()=>{
  const f=setup("sphere");
  f.sense.distance=8;f.tick(1);assert.equal(f.state.opacity,0);
  f.sense.distance=5.5;f.tick(1);assert.ok(f.state.opacity>.45 && f.state.opacity<.55);
  f.sense.distance=2;f.tick(1);assert.ok(f.state.opacity>.99);
  f.sense.distance=10;f.tick(1);assert.ok(f.state.opacity<.01);
});
test("gaze needs continuous centered unobstructed viewing and remains revealed afterward",()=>{
  const f=setup("cone");
  f.tick(GAZE_SECONDS/2);assert.equal(f.state.revealed,false);assert.ok(f.state.progress>0);
  f.sense.aimed=false;f.tick(.05);assert.equal(f.state.progress,0);
  f.sense.aimed=true;f.sense.visible=false;f.tick(3);assert.equal(f.state.revealed,false);
  f.sense.visible=true;f.tick(GAZE_SECONDS+.1);assert.equal(f.state.revealed,true);
  f.sense.aimed=false;f.tick(1);assert.ok(f.state.opacity>.99);
});
test("waiting requires a stationary grounded player nearby, without requiring gaze",()=>{
  const f=setup("ring");f.sense.aimed=false;
  f.tick(1);assert.ok(f.state.progress>0);assert.equal(f.state.revealed,false);
  f.player.x+=.05;f.tick(1/60);assert.equal(f.state.progress,0);
  f.sense.sameLevel=false;f.tick(4);assert.equal(f.state.revealed,false);
  f.sense.sameLevel=true;f.player.grounded=false;f.tick(4);assert.equal(f.state.revealed,false);
  f.player.grounded=true;f.sense.visible=false;f.tick(4);assert.equal(f.state.revealed,false);
  f.sense.visible=true;f.tick(WAIT_SECONDS+.1);assert.equal(f.state.revealed,true);
});
test("touch toggles on nearby taps or contact entry, never continuously or through barriers",()=>{
  const f=setup("box");
  f.tick(.5,"first");assert.equal(f.state.expanded,true);
  f.tick(.5,"first");assert.equal(f.state.expanded,false);
  f.sense.visible=false;f.tick(.5,"first");assert.equal(f.state.expanded,false);
  f.sense.visible=true;f.sense.distance=5;f.tick(.5,"first");assert.equal(f.state.expanded,false);
  f.sense.distance=.8;f.tick(2);assert.equal(f.state.expanded,true);
  f.tick(2);assert.equal(f.state.expanded,true);
  f.sense.distance=2;f.tick(.1);f.sense.distance=.8;f.tick(.5);assert.equal(f.state.expanded,false);
});
test("passing crosses a finite oriented gate; proximity, parallel travel and teleports do not trigger",()=>{
  const f=setup("bar");
  f.player.z=8.1;f.tick(.1);assert.equal(f.state.revealed,false);
  f.player.z=7.9;f.tick(.1);assert.equal(f.state.revealed,true);assert.ok(f.state.z<f.player.z);
  f.tick(.6);f.player.z=8.1;f.tick(.1);assert.equal(f.state.revealed,false);
  const p={x:6,z:8.1,feet:0,grounded:true};
  assert.equal(crossesSymbol(p,{...p,z:7.9},f.state),true);
  assert.equal(crossesSymbol({...p,z:8},{...p,z:7.9},f.state),false);
  assert.equal(crossesSymbol({...p,x:7},{...p,x:7,z:7.9},f.state),false);
  assert.equal(crossesSymbol(p,{...p,x:6.2},f.state),false);
  assert.equal(crossesSymbol(p,{...p,z:6},f.state),false);
  assert.equal(crossesSymbol(p,{...p,z:7.9,grounded:false},f.state),false);
  assert.equal(crossesSymbol({...p,x:6.1,z:8},{...p,x:5.9,z:8},{...f.state,rotation:90}),true);
});
test("a single guide stays in place; repeated diamonds form one deterministic route and wait for a trailing player",()=>{
  const f=setup("diamond");f.tick(2);assert.equal(f.state.destination,null);assert.equal(f.state.z,8);
  f.world.objects.push({id:"second",asset:"a",x:6,z:6,scale:1,rotation:0},{id:"third",asset:"a",x:8,z:6,scale:1,rotation:0});
  syncSymbols(f.session,createSimulation(f.world).actors,f.world.assets,f.world.start);
  f.senses.set("second",{...f.sense,distance:6});f.senses.set("third",{...f.sense,distance:9});
  assert.equal(f.session.states.get("second")!.leader,"first");
  assert.equal(f.session.states.get("second")!.opacity,0);
  f.tick(.05);assert.equal(f.state.destination,"second");
  f.tick(1);assert.ok(f.state.z<8 && f.state.z>6);
  const z=f.state.z;f.sense.distance=10;f.tick(2);assert.equal(f.state.z,z);
  f.sense.distance=4;f.tick(3);assert.equal(f.state.z,6);assert.equal(f.state.destination,null);
  f.sense.distance=2;f.tick(.05);assert.equal(f.state.destination,"third");
  assert.deepEqual(f.world.objects.map(o=>[o.x,o.z]),[[6,8],[6,6],[8,6]]);
});
test("symbol state survives routine actor refresh, resets per play, and does not mutate saved media or rules",()=>{
  const f=setup("ring"), serialized=JSON.stringify(f.world);
  f.tick(4);assert.equal(f.state.revealed,true);
  syncSymbols(f.session,createSimulation(f.world).actors,f.world.assets,f.world.start);
  assert.equal(f.session.states.get("first")!.revealed,true);
  assert.equal(JSON.stringify(f.world),serialized);
  const fresh=createSymbolSession();syncSymbols(fresh,createSimulation(f.world).actors,f.world.assets);
  assert.equal(fresh.states.get("first")!.revealed,false);
  f.world.assets[0].image=undefined;syncSymbols(f.session,createSimulation(f.world).actors,f.world.assets);
  assert.equal(f.session.states.size,0);
});
test("time gaps cannot instantly complete discovery and removed actors cannot trigger",()=>{
  const f=setup("ring");stepSymbols(f.session,f.senses,f.player,100);assert.ok(f.state.progress<.02);
  const actors=createSimulation(f.world).actors;actors[0].removed=true;
  syncSymbols(f.session,actors,f.world.assets);assert.equal(f.session.states.size,0);
});

async function rendered(shape: Shape) {
  const THREE = await import("three");
  const {makeSymbolExperience} = await import("../components/whistle/SymbolExperience.ts");
  const {flatTerrain} = await import("../lib/terrain.ts");
  const {deriveEnvironment} = await import("../lib/environment.ts");
  const f = setup(shape);
  f.world.terrain = flatTerrain(f.world.size);
  f.world.objects[0].z = 9;
  const actors = createSimulation(f.world).actors;
  const environment = deriveEnvironment(f.world);
  const camera = new THREE.PerspectiveCamera(66,1,.08,80);
  camera.position.set(1,1.35,9);
  camera.lookAt(1,1.15,7);
  const model = new THREE.Group();
  const picture = new THREE.Mesh(new THREE.PlaneGeometry(1.5,1.5),new THREE.MeshBasicMaterial({transparent:true,side:THREE.DoubleSide}));
  picture.name = "symbol-content";
  const light = new THREE.Sprite(new THREE.SpriteMaterial({transparent:true}));
  light.name = "symbol-light";
  model.add(picture,light);
  const experience = makeSymbolExperience();
  const frame = {world:f.world,actors,models:new Map([["first",model]]),camera,environment,structures:[],terrain:new THREE.Group(),player:{x:6,z:10},feet:0,grounded:true,dt:1/60,time:0,reducedMotion:true,daylight:1};
  const tick = (seconds: number) => {for(let i=0;i<Math.ceil(seconds*60);i++){frame.time+=1000/60;experience.update(frame);}};
  return {THREE,...f,experience,frame,picture,light,model,tick};
}
test("first-person gaze cannot reveal content through a terrain obstruction",async()=>{
  const f=await rendered("cone");
  const wall=new f.THREE.Mesh(new f.THREE.BoxGeometry(3,4,.3),new f.THREE.MeshBasicMaterial());
  wall.position.set(1,2,8);wall.userData.interactionOccluder=true;f.frame.terrain.add(wall);
  f.tick(3);assert.equal(f.picture.visible,false);assert.equal(f.light.visible,true);
  f.frame.terrain=new f.THREE.Group();f.tick(2);assert.equal(f.picture.visible,true);assert.ok(f.picture.material.opacity>.9);
});
test("discovery lights stay above grass and water and never require a ground mark",async()=>{
  const f=await rendered("ring");
  f.frame.player={x:6,z:11};
  f.frame.camera.position.z=11;
  const i=9*f.world.size+6;
  f.frame.environment.cells[i].grass=1;
  f.tick(.1);assert.ok(f.light.getWorldPosition(new f.THREE.Vector3()).y>=1.7);
  assert.equal(f.model.getObjectByName("mark"),undefined);
  f.frame.environment.cells[i].grass=0;
  for (let z = 8; z <= 10; z++) for (let x = 5; x <= 7; x++)
    f.world.terrain!.tiles[z*f.world.size+x] = { height: 3, surface: "plain" };
  f.world.terrain!.tiles[i] = { height: 2, surface: "slick" };
  const { deriveEnvironment } = await import("../lib/environment.ts");
  f.frame.environment = deriveEnvironment(f.world);
  f.tick(.1);assert.ok(f.light.getWorldPosition(new f.THREE.Vector3()).y>3);
});
test("screen-center tapping reaches the nearby touch content and toggles its rendered size",async()=>{
  const f=await rendered("box");f.tick(.3);
  const bounds={left:0,top:0,width:200,height:200} as DOMRect;
  f.experience.tap(100,100,bounds);f.tick(.5);assert.ok(f.picture.scale.x>1.3);
  f.experience.tap(100,100,bounds);f.tick(.5);assert.ok(f.picture.scale.x<1.02);
  f.frame.grounded=false;f.tick(.1);f.experience.tap(100,100,bounds);f.tick(.5);assert.ok(f.picture.scale.x<1.02);
});

test("six-cell clusters generate symbols while smaller patches stay sparse", async () => {
  const { deriveSymbolSites } = await import("../lib/symbol-sites.ts");
  const { flatTerrain } = await import("../lib/terrain.ts");
  const { deriveEnvironment } = await import("../lib/environment.ts");
  const world = starterWorld(); world.objects = []; world.terrain = flatTerrain(world.size);
  for (const i of [13, 14, 15, 49, 50, 51]) world.terrain.tiles[i].surface = "soft";
  assert.equal(deriveSymbolSites(world, deriveEnvironment(world)).length, 0);
  world.terrain.tiles.forEach(tile => { tile.surface = "plain"; });
  for (let z = 1; z <= 2; z++) for (let x = 1; x <= 3; x++) world.terrain.tiles[z * world.size + x].surface = "soft";
  const sites = deriveSymbolSites(world, deriveEnvironment(world));
  assert.equal(sites.filter(s => s.kind === "cluster").length, 1);
  assert.deepEqual(sites, deriveSymbolSites(world, deriveEnvironment(world)));
  world.terrain.tiles[9 * world.size + 9].height = 1;
  assert.equal(deriveSymbolSites(world, deriveEnvironment(world)).filter(s => s.kind === "peak").length, 0);
  world.terrain.tiles[9 * world.size + 9].height = 2;
  const both = deriveSymbolSites(world, deriveEnvironment(world));
  assert.equal(both.filter(s => s.kind === "peak").length, 1);
  assert.ok(both.length <= 3);
  for (const a of both) for (const b of both) if (a !== b) assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= 3);
});

test("filled sites retain their coordinates and content through expansion, removal and serialization", async () => {
  const { deriveSymbolSites, siteAsset, SITE_TYPES } = await import("../lib/symbol-sites.ts");
  const { flatTerrain } = await import("../lib/terrain.ts");
  const { deriveEnvironment } = await import("../lib/environment.ts");
  const { validateWorld } = await import("../lib/world.ts");
  const world = starterWorld(); world.objects = []; world.terrain = flatTerrain(world.size);
  for (let z = 2; z <= 4; z++) for (let x = 2; x <= 4; x++) world.terrain.tiles[z * world.size + x].surface = "soft";
  const site = deriveSymbolSites(world, deriveEnvironment(world))[0];
  const asset = { ...siteAsset(site, "saved-site"), image: "data:image/png;base64,YQ==" };
  world.assets.push(asset);
  world.objects.push({ id: "filled", asset: asset.id, x: site.x, z: site.z, scale: 1, rotation: 0,
    site: { kind: site.kind, cells: site.cells, height: 0 } });
  const original = structuredClone(world.objects[0]);
  for (let z = 1; z <= 5; z++) for (let x = 1; x <= 5; x++) world.terrain.tiles[z * world.size + x].surface = "soft";
  assert.equal(deriveSymbolSites(world, deriveEnvironment(world)).filter(s => s.kind === "cluster").length, 0);
  world.terrain.tiles.forEach(tile => { tile.surface = "plain"; });
  assert.deepEqual(validateWorld(JSON.parse(JSON.stringify(world))).objects[0], original);
  assert.equal(world.assets.find(a => a.id === asset.id)?.image, asset.image);
  assert.equal(SITE_TYPES.cluster.media, "image");
  assert.equal(SITE_TYPES.peak.media, "text");
  assert.equal(SITE_TYPES.boundary.media, "text");
  const invalid = structuredClone(world); invalid.objects[0].site!.cells = [9999];
  assert.throws(() => validateWorld(invalid));
});

import { contentOpacity, floatingPose } from "../lib/content-display.ts";
test("content fades with distance or a slow cycle, with a steady reduced-motion fallback", () => {
  assert.equal(contentOpacity("nearby", 10, 0, 0), 0);
  assert.equal(contentOpacity("nearby", 3, 0, 0), 1);
  assert.equal(contentOpacity("nearby", 6.5, 0, 0), .5);
  assert.equal(contentOpacity("pulse", 0, 2.5, 0), 1);
  assert.equal(contentOpacity("pulse", 0, 7.5, 0), 0);
  assert.equal(contentOpacity("pulse", 0, 7.5, 0, true), 1);
  assert.equal(contentOpacity("steady", 100, 0, 0), 1);
});

import * as THREE from "three";
import { makeContentPresentation } from "../components/whistle/ContentPresentation.ts";
test("surface fading changes the coating and decal while leaving terrain geometry opaque", () => {
  const world = starterWorld();
  const actor = createSimulation(world).actors[0];
  const asset = { ...world.assets.find(a => a.id === actor.asset)!, display: "nearby" as const, placement: "surface" as const };
  const model = new THREE.Group(), terrain = new THREE.Group();
  const decal = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial({ transparent: true }));
  model.userData.surface = true; model.add(decal);
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshStandardMaterial());
  grass.userData.placementId = actor.id;
  grass.material.userData.surfaceProjection = { opacity: { value: 1 } };
  terrain.add(grass);
  const presentation = makeContentPresentation(), camera = new THREE.PerspectiveCamera();
  presentation.sync([actor], new Map([[actor.id, asset]]), new Map([[actor.id, model]]), terrain);
  camera.position.set(100, 2, 100);
  presentation.update(camera, world.size, 0, false, false);
  assert.equal(decal.material.opacity, 0);
  assert.equal(grass.material.userData.surfaceProjection.opacity.value, 0);
  assert.equal(grass.material.opacity, 1);
  presentation.update(camera, world.size, 0, true, false);
  assert.equal(decal.material.opacity, 1);
  assert.equal(grass.material.userData.surfaceProjection.opacity.value, 1);
  decal.geometry.dispose(); decal.material.dispose(); grass.geometry.dispose(); grass.material.dispose();
});

for (const kind of ["text", "image"] as const) test(`a ${kind} coating reveals at five tiles and fades on approach before crossing`, () => {
  const world = starterWorld(), camera = new THREE.PerspectiveCamera();
  const actor = { ...createSimulation(world).actors[0], x: 3, z: 2, scale: 1 };
  const asset = { ...world.assets[0], id: actor.asset, display: "pulse" as const, text: kind === "text" ? "한 줄" : undefined, image: "fixture-image" };
  const model = new THREE.Group(), terrain = new THREE.Group();
  model.userData.surface = true;
  const coating = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshStandardMaterial({ map: new THREE.Texture() }));
  const opacity = { value: 1 };
  coating.material.userData.surfaceProjection = { opacity };
  coating.userData.placementId = actor.id;
  terrain.add(coating);
  const session = makeContentPresentation();
  const sync = () => session.sync([actor], new Map([[actor.id, asset]]), new Map([[actor.id, model]]), terrain, () => 4);
  sync();
  let time = 0;
  const step = (ms: number) => {
    for (let i = 0; i < ms; i += 50) session.update(camera, world.size, time += 50, false, false);
  };
  camera.position.set(actor.x * 2 - world.size + 1, 5, actor.z * 2 - world.size + 16);
  step(1500);
  assert.equal(opacity.value, 0);
  camera.position.z -= 5;
  step(200);
  assert.ok(opacity.value > 0 && opacity.value < 1);
  step(1600);
  assert.equal(opacity.value, 1);
  camera.position.z -= 7;
  assert.equal(session.passContent(3, 3.8, 3, 3.6, 4), 0);
  step(200);
  assert.ok(opacity.value > 0 && opacity.value < 1);
  assert.equal(session.passContent(3, 3.2, 3, 2.7, 4), 0);
  assert.equal(session.passContent(3, 2.7, 3, 1.8, 10), 0);
  assert.equal(session.passContent(3, 2.7, 3, 1.8, 4), 1);
  step(500);
  assert.ok(opacity.value > 0 && opacity.value < 1);
  sync();
  step(1000);
  assert.equal(opacity.value, 0);
  assert.equal(coating.material.opacity, 1);
  assert.equal(session.passContent(3, 1.8, 3, 2.5, 4), 0);
  camera.position.z += 7;
  step(100);
  camera.position.z -= 7;
  step(1600);
  assert.equal(opacity.value, 1);
  assert.equal(session.passContent(3, 3, 3, 1.8, 4), 1);
  coating.material.map!.dispose(); coating.material.dispose(); coating.geometry.dispose();
});

test("floating content stays higher and drifts gently without movement under reduced motion", () => {
  const poses = Array.from({ length: 120 }, (_, i) => floatingPose(i / 4, 1.2));
  assert.ok(poses.every(pose => pose.y >= 2.55 && pose.y <= 3.25 && Math.abs(pose.x) <= .16));
  assert.ok(Math.max(...poses.map(pose => pose.y)) - Math.min(...poses.map(pose => pose.y)) > .45);
  assert.deepEqual(floatingPose(0, 1.2, true), floatingPose(7, 1.2, true));
  assert.equal(floatingPose(0, 0, true).y, 2.9);
});

test("short interfaces do not create a boundary; extended interfaces do, until filled slots reach the cap", async () => {
  const { deriveSymbolSites } = await import("../lib/symbol-sites.ts");
  const { flatTerrain } = await import("../lib/terrain.ts");
  const { deriveEnvironment } = await import("../lib/environment.ts");
  const world = starterWorld(); world.objects = []; world.terrain = flatTerrain(world.size);
  for (let z = 1; z <= 3; z++) for (let x = 1; x <= 10; x++) world.terrain.tiles[z * world.size + x].surface = x <= 5 ? "soft" : "rough";
  assert.ok(!deriveSymbolSites(world, deriveEnvironment(world)).some(site => site.kind === "boundary"));
  for (let z = 4; z <= 4; z++) for (let x = 1; x <= 10; x++) world.terrain.tiles[z * world.size + x].surface = x <= 5 ? "soft" : "rough";
  assert.ok(deriveSymbolSites(world, deriveEnvironment(world)).some(site => site.kind === "boundary"));
  world.assets[0].image = "data:image/png;base64,YQ==";
  world.objects = [1, 5, 9].map(x => ({ id: `filled-${x}`, asset: world.assets[0].id, x, z: 10, scale: 1, rotation: 0 }));
  assert.deepEqual(deriveSymbolSites(world, deriveEnvironment(world)), []);
});
