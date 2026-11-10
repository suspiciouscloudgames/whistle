import * as THREE from "three";
import type { Actor, Asset, World } from "../../lib/world.ts";
import { floorHeight, type Structure } from "../../lib/terrain.ts";
import { environmentAt, type Environment } from "../../lib/environment.ts";
import { createSymbolSession, interactionKind, syncSymbols, stepSymbols, type SymbolSense } from "../../lib/symbol-interactions.ts";

export function addSymbolVisuals(model: THREE.Group, picture: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>, asset: Asset) {
  picture.name = "symbol-content";
  picture.material.depthWrite = false;
  if (asset.text !== undefined) {
    const ink = {value: new THREE.Color("#111111")};
    picture.material.userData.symbolInk = ink;
    picture.material.onBeforeCompile = shader => {
      shader.uniforms.symbolInk = ink;
      shader.fragmentShader = "uniform vec3 symbolInk;\n" + shader.fragmentShader.replace("#include <map_fragment>","#include <map_fragment>\n diffuseColor.rgb = symbolInk;");
    };
    picture.material.customProgramCacheKey = () => "whistle-symbol-text";
  }
  const kind = interactionKind(asset.shape);
  picture.material.opacity = kind === "touch" || kind === "follow" ? 1 : 0;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const context = canvas.getContext("2d")!;
  const glow = context.createRadialGradient(32,32,0,32,32,32);
  glow.addColorStop(0,"rgba(255,255,255,1)");
  glow.addColorStop(.12,"rgba(255,255,255,.95)");
  glow.addColorStop(.32,"rgba(210,217,221,.5)");
  glow.addColorStop(.58,"rgba(75,85,92,.13)");
  glow.addColorStop(1,"rgba(75,85,92,0)");
  context.fillStyle = glow;
  context.fillRect(0,0,64,64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const light = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture, transparent: true, depthTest: true, depthWrite: false, toneMapped: false,
  }));
  light.name = "symbol-light";
  light.visible = false;
  model.add(light);
}

type Frame = {
  world: World;
  actors: Actor[];
  models: Map<string, THREE.Group>;
  camera: THREE.Camera;
  environment: Environment;
  structures: Structure[];
  terrain: THREE.Group;
  player: { x: number; z: number };
  feet: number;
  grounded: boolean;
  dt: number;
  time: number;
  reducedMotion: boolean;
  daylight: number;
};
export function makeSymbolExperience() {
  const session = createSymbolSession();
  const senses = new Map<string, SymbolSense>();
  const sight = new Map<string, {time: number; visible: boolean}>();
  const ray = new THREE.Raycaster(), point = new THREE.Vector3(), direction = new THREE.Vector3(), projected = new THREE.Vector3();
  const occluders: THREE.Object3D[] = [];
  let lastTerrain: THREE.Group | null = null;
  let lastActors: Actor[] | null = null, lastAssets: Asset[] | null = null;
  let tapped: string | null = null;
  let latest: Frame | null = null;
  function unobstructed(camera: THREE.Camera, target: THREE.Vector3) {
    direction.subVectors(target,camera.position);
    ray.far = Math.max(0, direction.length() - .08);
    ray.set(camera.position,direction.normalize());
    return ray.intersectObjects(occluders,false).length === 0;
  }
  function position(frame: Frame) {
    const toScene = (n: number) => n * 2 - frame.world.size + 1;
    for (const actor of frame.actors) {
      const state = session.states.get(actor.id), model = frame.models.get(actor.id);
      if (!state || !model) continue;
      const x = state.kind === "follow" || state.kind === "cross" ? state.x : actor.x;
      const z = state.kind === "follow" || state.kind === "cross" ? state.z : actor.z;
      const ground = floorHeight(frame.world,x,z,frame.structures) ?? 0;
      const conditions = environmentAt(frame.environment,x,z);
      const surface = Math.max(ground, conditions.water ?? -Infinity);
      const clearance = conditions.grass > .1 ? 1.7 : 1.15;
      const center = Math.max(.8 * actor.scale, clearance);
      model.position.set(toScene(x),surface,toScene(z));
      model.rotation.set(0,Math.atan2(frame.camera.position.x-model.position.x,frame.camera.position.z-model.position.z),0);
      const picture = model.getObjectByName("symbol-content")!;
      const light = model.getObjectByName("symbol-light")!;
      picture.position.y = center / actor.scale;
      light.position.y = center / actor.scale;
      model.updateMatrixWorld(true);
    }
  }
  return {
    update(frame: Frame) {
      latest = frame;
      if (lastActors !== frame.actors || lastAssets !== frame.world.assets) {
        syncSymbols(session,frame.actors,frame.world.assets,frame.world.start);
        lastActors = frame.actors;
        lastAssets = frame.world.assets;
      }
      if (lastTerrain !== frame.terrain) {
        occluders.length = 0;
        frame.terrain.traverse(o => {
          if (o.userData.interactionOccluder || o.name === "generated-trunks") occluders.push(o);
        });
        frame.terrain.updateMatrixWorld(true);
        sight.clear();
        lastTerrain = frame.terrain;
      }
      frame.camera.updateMatrixWorld(true);
      position(frame);
      senses.clear();
      for (const state of session.states.values()) {
        const model = frame.models.get(state.id);
        if (!model?.visible) continue;
        const content = model.getObjectByName("symbol-content");
        if (!content) continue;
        content.getWorldPosition(point);
        const distance = point.distanceTo(frame.camera.position);
        projected.copy(point).project(frame.camera);
        const aimed = projected.z >= -1 && projected.z <= 1 && Math.abs(projected.x) < .085 && Math.abs(projected.y) < .085;
        let cached = sight.get(state.id);
        const needsSight = distance <= 3.2 || (aimed && distance <= 12);
        if (needsSight && (!cached || frame.time - cached.time >= 120)) {
          cached = {time:frame.time,visible:unobstructed(frame.camera,point)};
          sight.set(state.id,cached);
        }
        const anchorFloor = floorHeight(frame.world,state.kind === "cross" ? state.anchorX : state.x,state.kind === "cross" ? state.anchorZ : state.z,frame.structures);
        senses.set(state.id, {
          distance, aimed, visible: needsSight && !!cached?.visible,
          sameLevel: anchorFloor !== null && Math.abs(anchorFloor-frame.feet) <= 1.3,
        });
      }
      stepSymbols(session,senses,{...frame.player,feet:frame.feet,grounded:frame.grounded},frame.dt,tapped);
      tapped = null;
      position(frame);
      for (const [id,state] of session.states) {
        const model = frame.models.get(id);
        if (!model?.visible) continue;
        const picture = model.getObjectByName("symbol-content") as THREE.Mesh<THREE.PlaneGeometry,THREE.MeshBasicMaterial>;
        const light = model.getObjectByName("symbol-light") as THREE.Sprite;
        picture.material.opacity = state.opacity;
        const ink = picture.material.userData.symbolInk as {value: THREE.Color} | undefined;
        ink?.value.setScalar(.9 - .87 * frame.daylight);
        picture.visible = state.opacity > .005;
        const expansion = state.kind === "touch" && state.expanded ? 1.35 : 1;
        const scale = picture.scale.x + (expansion-picture.scale.x) * (1-Math.exp(-9*frame.dt));
        picture.scale.setScalar(scale);
        let glow = 1-state.opacity;
        if (state.kind === "touch") glow = (senses.get(id)?.distance ?? Infinity) < 3 ? .18 : 0;
        if (state.kind === "follow" && state.leader === id) glow = .15;
        if (state.kind === "follow" && state.leader !== id) {
          const guide = session.states.get(state.leader);
          glow = guide?.visited.includes(id) ? 0 : guide?.destination === id ? .85 : .35;
        }
        light.visible = glow > .01;
        const pulse = frame.reducedMotion ? 1 : 1 + Math.sin(frame.time*.002 + state.anchorX)*.06;
        const diameter = (.58 - state.progress*.16) * pulse / model.scale.x;
        light.scale.setScalar(diameter);
        (light.material as THREE.SpriteMaterial).opacity = glow * (.65 + state.progress*.35);
        if (state.kind === "follow" && state.leader === id && !frame.reducedMotion)
          picture.position.y += Math.sin(frame.time*.002)*(.035+.04*state.progress)/model.scale.x;
      }
    },
    tap(clientX: number, clientY: number, bounds: DOMRect) {
      if (!latest?.grounded) return;
      const f = latest;
      f.camera.updateMatrixWorld(true);
      ray.setFromCamera(new THREE.Vector2((clientX-bounds.left)/bounds.width*2-1,1-(clientY-bounds.top)/bounds.height*2),f.camera);
      ray.far = 5;
      const pictures: THREE.Object3D[] = [];
      for (const [id,state] of session.states) {
        const model = f.models.get(id), sense = senses.get(id);
        if (state.kind !== "touch" || !model?.visible || !sense?.sameLevel || !sense.visible || sense.distance > 3) continue;
        const picture = model.getObjectByName("symbol-content");
        if (picture?.visible) pictures.push(picture);
      }
      const hit = ray.intersectObjects(pictures,false)[0];
      if (!hit || !unobstructed(f.camera,hit.point)) return;
      for (const [id,model] of f.models) if (hit.object.parent === model) {tapped=id;break;}
    },
    blocksMovement(id: string) {
      const state = session.states.get(id);
      return !!state && state.kind !== "follow" && state.kind !== "cross" && state.opacity > .8;
    },
    pause() {
      session.previous = null;
      for (const state of session.states.values()) if (!state.revealed) state.progress = 0;
      tapped = null;
      sight.clear();
    },
  };
}
