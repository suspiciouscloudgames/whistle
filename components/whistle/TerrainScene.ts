import { makeGround, type createTerrainCache } from "./TerrainGround.ts";
import { isGap, isHole } from "../../lib/tile.ts";
import * as THREE from "three";
import { deriveEnvironment, type Environment } from "../../lib/environment.ts";
import { makeEnvironment } from "./EnvironmentScene.ts";
import { makeWindField } from "./WindField.ts";
import { makeStoneSurfaces } from "./StoneSurfaces.ts";
import { stoneGeometry, STONE_SHAPES } from "./StoneGeometry.ts";
import { stoneAppearance } from "../../lib/stones.ts";
import type { Actor, Asset, World, Weather } from "@/lib/world";
import {
  LEVEL,
  randomSequence,
  terrainSample,
  type Structure,
} from "../../lib/terrain.ts";


export function makeTerrain(world: World, structures: Structure[], derivedEnvironment?: Environment, cache?:ReturnType<typeof createTerrainCache>, compactOverview = false) {
  const group = new THREE.Group(),
    wind = { value: 0 };
  const environment = derivedEnvironment ?? deriveEnvironment(world, structures);
  const toScene = (n: number) => n * 2 - world.size + 1;
  const random = randomSequence(world.terrain?.seed ?? 0);
  const ground = makeGround(world, environment, cache, compactOverview ? 6 : 12);
  const geometry = ground.geometry;
  group.add(...ground.group.children.slice());
  if (!world.terrain?.floating && world.terrain?.tiles.some((t) => isHole(t))) {
    const bottom = new THREE.Mesh(
      new THREE.PlaneGeometry(world.size * 2, world.size * 2),
      new THREE.MeshStandardMaterial({ color: "#121519", roughness: 1 }),
    );
    bottom.name = "hole-bottom";
    bottom.rotation.x = -Math.PI / 2;
    bottom.position.y = -18;
    group.add(bottom);
  }

  const railWidth = 0.04, rungWidth = 0.065, rungHeight = 0.035;
  const architecture: {
    x: number;
    y: number;
    z: number;
    w: number;
    h: number;
    d: number;
    rotation?: THREE.Quaternion;
    ladder?: boolean;
  }[] = [];
  for (const s of structures) {
    const x = toScene(s.x),
      z = toScene(s.z),
      y = s.height * LEVEL;
    if (s.kind === "stairs") {
      const bottom = new THREE.Vector3(toScene(s.x+s.dx*.16), terrainSample(world,s.x+s.dx*.16,s.z+s.dz*.16).height+.09, toScene(s.z+s.dz*.16));
      const top = new THREE.Vector3(toScene(s.x+s.dx*.84), terrainSample(world,s.x+s.dx*.84,s.z+s.dz*.84).height+.09, toScene(s.z+s.dz*.84));
      const direction = top.clone().sub(bottom);
      const rungCount = Math.max(3,Math.ceil(direction.length()/.46));
      for (let step = 0; step < rungCount; step++) {
        const along = (step+.5)/rungCount, t = .16+.68*along,
          gx = s.x + s.dx * t,
          gz = s.z + s.dz * t;
        architecture.push({
          x: toScene(gx),
          z: toScene(gz),
          y: terrainSample(world,gx,gz).height+.07,
          w: s.dx ? rungWidth : .5,
          d: s.dz ? rungWidth : .5,
          h: rungHeight,
          ladder: true,
        });
        for (const side of [-1,1]) {
          const railPoint = (part: number) => {
            const g=.16+.68*part, rx=s.x+s.dx*g-s.dz*.125*side, rz=s.z+s.dz*g+s.dx*.125*side;
            return new THREE.Vector3(toScene(rx),terrainSample(world,rx,rz).height+.065,toScene(rz));
          };
          const a=railPoint(step/rungCount), b=railPoint((step+1)/rungCount);
          const rail=b.clone().sub(a), center=a.clone().add(b).multiplyScalar(.5);
          architecture.push({x:center.x,y:center.y,z:center.z,w:railWidth,h:rail.length()+.012,d:railWidth,
            rotation:new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),rail.normalize()),ladder:true});
        }

      }
    }
    if (s.kind === "bridge") {
      const alongX = s.dx !== 0;
      for (const side of [-1, 1]) {
        const offset = side * (1 - railWidth / 2);
        architecture.push({
          x: alongX ? x : x + offset, z: alongX ? z + offset : z, y: y - rungHeight - railWidth / 2,
          w: alongX ? 2 : railWidth, d: alongX ? railWidth : 2, h: railWidth,
        });
      }
      const rungCount = 5;
      for (let step = 0; step < rungCount; step++) {
        const offset = (step + 0.5) * 2 / rungCount - 1;
        architecture.push({
          x: alongX ? x + offset : x, z: alongX ? z : z + offset, y: y - rungHeight / 2,
          w: alongX ? rungWidth : 2, d: alongX ? 2 : rungWidth, h: rungHeight,
        });
      }
    }
    if (s.kind === "canopy") {
      const roofY = y + 3.25;
      for (const dx of [-2, 2]) {
        architecture.push({ x: x + dx, y: roofY, z, w: railWidth, d: 4 + railWidth, h: railWidth });
        for (const dz of [-2, 2]) {
          const base = terrainSample(world, s.x + dx / 2, s.z + dz / 2).height;
          const postHeight = roofY - railWidth / 2 - base;
          architecture.push({
            x: x + dx, z: z + dz, y: base + postHeight / 2,
            w: railWidth, d: railWidth, h: postHeight,
          });
        }
      }
      const intervals = 9;
      for (let step = 0; step <= intervals; step++) {
        architecture.push({
          x, z: z - 2 + step * 4 / intervals, y: roofY + (railWidth + rungHeight) / 2,
          w: 4 + railWidth, d: rungWidth, h: rungHeight,
        });
      }
    }
  }
  const matrix = new THREE.Matrix4(),
    p = new THREE.Vector3(),
    q = new THREE.Quaternion(),
    scale = new THREE.Vector3();
  for (const ladder of [false,true]) {
    const pieces=architecture.filter(piece=>!!piece.ladder === ladder);
    if (!pieces.length) continue;
    const built = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: "#a0a0a0", roughness: 1 }),
      pieces.length,
    );
    pieces.forEach((b, i) => {
      matrix.compose(p.set(b.x, b.y, b.z), b.rotation ?? q, scale.set(b.w, b.h, b.d));
      built.setMatrixAt(i, matrix);
    });
    built.castShadow = built.receiveShadow = true;
    built.name = ladder ? "abstract-ladders" : "lightweight-structures";
    built.userData.interactionOccluder = true;
    group.add(built);
  }


  const pebbles: {
    x: number;
    y: number;
    z: number;
    appearance: ReturnType<typeof stoneAppearance>;
  }[] = [];
  // Only the four sampling cells touching a rough tile can produce a pebble.
  const stride = world.size + 1;
  const roughCorners = new Uint8Array(stride * stride);
  world.terrain?.tiles.forEach((tile, index) => {
    if (isGap(tile) || tile.surface !== "rough") return;
    const cell = Math.floor(index / world.size) * stride + index % world.size;
    roughCorners[cell] = roughCorners[cell + 1] = roughCorners[cell + stride] = roughCorners[cell + stride + 1] = 1;
  });
  const attempts = roughCorners.includes(1) ? Math.min(world.size * world.size * 750, 90000) : 0;
  for (let n = 0; n < attempts; n++) {
    const x = random() * world.size - 0.5,
      z = random() * world.size - 0.5;
    if (!roughCorners[(Math.floor(z) + 1) * stride + Math.floor(x) + 1]) continue;
    const sample = terrainSample(world, x, z, false);
    if (sample.coverage < 0.6) continue;
    const onStairs = structures.some(
      (s) =>
        s.kind === "stairs" &&
        Math.abs(x - (s.x + s.dx * 0.5)) < 0.55 &&
        Math.abs(z - (s.z + s.dz * 0.5)) < 0.55,
    );
    if (onStairs) continue;
    if (sample.weights.rough > 0.5 && random() < 0.035 && pebbles.length < 900)
      pebbles.push({
        x: toScene(x),
        y: terrainSample(world, x, z).height,
        z: toScene(z),
        appearance: stoneAppearance(world.terrain?.seed ?? 0, x, z),
      });
  }
  if (pebbles.length) {
    const grainData = new Uint8Array(64 * 64 * 4);
    for (let i = 0; i < 64 * 64; i++) {
      const value = 150 + Math.floor(random() * 105);
      grainData.set([value, value, value, 255], i * 4);
    }
    const stoneGrain = new THREE.DataTexture(
      grainData,
      64,
      64,
      THREE.RGBAFormat,
    );
    stoneGrain.wrapS = stoneGrain.wrapT = THREE.RepeatWrapping;
    stoneGrain.magFilter = THREE.LinearFilter;
    stoneGrain.minFilter = THREE.LinearFilter;
    stoneGrain.needsUpdate = true;
    const stoneMaterial = new THREE.MeshStandardMaterial({
      color: "#ffffff", roughness: 0.92, bumpMap: stoneGrain, bumpScale: 0.018,
    });
    stoneMaterial.onBeforeCompile = (shader) => {
      shader.vertexShader = "attribute vec3 stoneVariant; varying vec3 vStoneVariant; varying vec3 vStonePoint;\n" + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nvStoneVariant = stoneVariant; vStonePoint = position;");
      shader.fragmentShader = `varying vec3 vStoneVariant;
        varying vec3 vStonePoint;
        float stoneHash(vec3 p) { return fract(sin(dot(p, vec3(127.1,311.7,74.7))) * 43758.5453); }
        float stoneNoise(vec3 p) {
          vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(mix(stoneHash(i),stoneHash(i+vec3(1,0,0)),f.x),
                         mix(stoneHash(i+vec3(0,1,0)),stoneHash(i+vec3(1,1,0)),f.x),f.y),
                     mix(mix(stoneHash(i+vec3(0,0,1)),stoneHash(i+vec3(1,0,1)),f.x),
                         mix(stoneHash(i+vec3(0,1,1)),stoneHash(i+vec3(1,1,1)),f.x),f.y),f.z);
        }
      ` + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>", `#include <color_fragment>
        vec3 sp = vStonePoint * vStoneVariant.y + vStoneVariant.z;
        float mottling = stoneNoise(sp * 4.0);
        float grainFade = 1.0-smoothstep(.4,1.6,length(fwidth(sp*37.0)));
        float grain = mix(.5,stoneNoise(sp * 37.0),grainFade);
        float vein = 1.0-smoothstep(0.035,0.13,abs(sin(sp.y*8.0+sp.x*3.0+mottling*4.0)));
        float finish = vStoneVariant.x;
        float tone = finish < 0.5 ? 0.65+mottling*0.5+grain*0.3
          : finish < 1.5 ? 0.8+mottling*0.3+vein*0.26
          : 0.7+mottling*0.4+smoothstep(0.55,0.8,grain)*0.35;
        diffuseColor.rgb *= tone;
      `);
    };
    const stoneCompile = stoneMaterial.onBeforeCompile;
    stoneMaterial.onBeforeCompile = (shader, renderer) => {
      stoneCompile.call(stoneMaterial, shader, renderer);
      shader.fragmentShader = shader.fragmentShader.replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
        roughnessFactor = clamp(.86 + vStoneVariant.x*.035 + (grain-.5)*.04, .8, 1.);
      `);
    };
    for (let shape = 0; shape < STONE_SHAPES.length; shape++) {
      const batch = pebbles.filter(r => r.appearance.shape === shape);
      if (!batch.length) continue;
      const rockGeometry = stoneGeometry(shape, compactOverview);
      const stoneVariants = new Float32Array(batch.length * 3);
      rockGeometry.setAttribute("stoneVariant", new THREE.InstancedBufferAttribute(stoneVariants, 3));
      const rocks = new THREE.InstancedMesh(rockGeometry, stoneMaterial, batch.length);
      batch.forEach((r, i) => {
        const a = r.appearance;
        stoneVariants.set([a.texture, a.grain, a.offset], i * 3);
        const stoneColor = new THREE.Color(a.color);
        stoneColor.setScalar(stoneColor.r * .2126 + stoneColor.g * .7152 + stoneColor.b * .0722);
        rocks.setColorAt(i, stoneColor);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), a.angle);
        matrix.compose(
          p.set(r.x, r.y + a.size * a.height * .25, r.z),
          q,
          scale.set(a.size, a.size * a.height, a.size * a.depth),
        );
        rocks.setMatrixAt(i, matrix);
      });
      rocks.name = "scattered-stones";
      rocks.castShadow = rocks.receiveShadow = true;
      group.add(rocks);
    }
  }
  const stoneSurfaces = makeStoneSurfaces(world, group.children.filter(child => child.name === "scattered-stones") as THREE.InstancedMesh[]);
  group.add(stoneSurfaces.group);
  const paperField = makeWindField(world, structures, environment, geometry, compactOverview);
  group.add(paperField.group);
  const generated = makeEnvironment(world, environment, wind, geometry);
  group.add(generated.group);
  return {
    group,
    environment,
    setGrassDetail: paperField.setGrassDetail,
    setSurfaceImages: (actors: Actor[], assets: Asset[]) => {
      const treeImages = generated.setSurfaceImages(actors, assets);
      const rest = actors.filter(actor => !treeImages.has(actor.id));
      stoneSurfaces.setSurfaceImages(rest, assets);
      paperField.setSurfaceImages(rest, assets);
      return treeImages;
    },
    update: (time: number, camera?: THREE.Camera, mistColor?: THREE.Color, reducedMotion = false, weather: Weather = "clear", daylight = 1) => {
      wind.value = time / 1000;
      paperField.wind.time.value = time / 1000;
      paperField.wind.strength.value = reducedMotion ? 0 : 1;
      generated.update(time, camera, mistColor, reducedMotion, weather, daylight);
    },
  };
}
