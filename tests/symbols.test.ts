import test from "node:test";
import assert from "node:assert/strict";
import {createSymbolSession, syncSymbols, stepSymbols, crossesSymbol, interactionKind, GAZE_SECONDS, WAIT_SECONDS, type SymbolSense} from "../lib/symbol-interactions.ts";
import {starterWorld, createSimulation, type Shape} from "../lib/world.ts";

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
  f.frame.environment.cells[i].water=2;
  f.tick(.1);assert.ok(f.light.getWorldPosition(new f.THREE.Vector3()).y>3);
});
test("screen-center tapping reaches the nearby touch content and toggles its rendered size",async()=>{
  const f=await rendered("box");f.tick(.3);
  const bounds={left:0,top:0,width:200,height:200} as DOMRect;
  f.experience.tap(100,100,bounds);f.tick(.5);assert.ok(f.picture.scale.x>1.3);
  f.experience.tap(100,100,bounds);f.tick(.5);assert.ok(f.picture.scale.x<1.02);
  f.frame.grounded=false;f.tick(.1);f.experience.tap(100,100,bounds);f.tick(.5);assert.ok(f.picture.scale.x<1.02);
});
