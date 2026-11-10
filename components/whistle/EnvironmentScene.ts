import * as THREE from "three";
import { makeTrees } from "./Trees.ts";
import { makeWaterSurface } from "./WaterSurface.ts";
import { makeDrainFlow } from "./DrainFlow.ts";
import { fogPatches } from "../../lib/environment-effects.ts";
import { waterWeights } from "../../lib/water.ts";
import type { World } from "../../lib/world.ts";
import { randomSequence, terrainSample } from "../../lib/terrain.ts";
import { type Environment } from "../../lib/environment.ts";

export function makeEnvironment(
  world: World,
  env: Environment,
  clock: { value: number },
) {
  const group = new THREE.Group();
  group.name = "generated-environment";
  const sceneCoord = (n: number) => n * 2 - world.size + 1;

  for (const pond of [...env.ponds].sort(
    (a, b) => b.cells.length - a.cells.length,
  )) {

    const minX = Math.min(...pond.cells.map((i) => i % world.size)) - 1.5,
      maxX = Math.max(...pond.cells.map((i) => i % world.size)) + 1.5;
    const minZ = Math.min(...pond.cells.map((i) => Math.floor(i / world.size))) - 1.5,
      maxZ = Math.max(...pond.cells.map((i) => Math.floor(i / world.size))) + 1.5;
    const positions: number[] = [],
      depths: number[] = [],
      indices: number[] = [],
      signed: number[] = [],
      constraints: number[][] = [];
    const nx = Math.ceil((maxX - minX) * 12),
      nz = Math.ceil((maxZ - minZ) * 12);
    for (let z = 0; z <= nz; z++)
      for (let x = 0; x <= nx; x++) {
        const gx = minX + ((maxX - minX) * x) / nx,
          gz = minZ + ((maxZ - minZ) * z) / nz,
          s = terrainSample(world, gx, gz);
        const depth = pond.level - s.height;
        positions.push(sceneCoord(gx), pond.level, sceneCoord(gz));
        depths.push(Math.max(0, depth));
        const wetWeight =
          waterWeights(env.size, gx, gz, (i) => env.cells[i].water, (i) => env.cells[i].hole).get(
            pond.level,
          ) ?? 0;
        const edge = [
          depth - 0.002,
          (wetWeight - 0.72) * 0.2,
          s.coverage - 0.5,
        ];
        constraints.push(edge);
        signed.push(Math.min(...edge));
      }
    const cuts = new Map<string, number>();
    const cut = (a: number, b: number) => {
      const key = a < b ? `${a}:${b}` : `${b}:${a}`,
        found = cuts.get(key);
      if (found !== undefined) return found;
      let low = 0,
        high = 1;
      for (let n = 0; n < 16; n++) {
        const mid = (low + high) / 2;
        const inside = constraints[a].every(
          (value, k) => value + (constraints[b][k] - value) * mid >= 0,
        );
        if (inside === signed[a] >= 0) low = mid;
        else high = mid;
      }
      const f = (low + high) / 2,
        i = depths.length;
      for (let n = 0; n < 3; n++)
        positions.push(
          positions[a * 3 + n] +
            (positions[b * 3 + n] - positions[a * 3 + n]) * f,
        );
      depths.push(0);
      signed.push(0);
      constraints.push([0, 0, 0]);
      cuts.set(key, i);
      return i;
    };
    const triangle = (a: number, b: number, c: number) => {
      const points = [a, b, c],
        out: number[] = [];
      for (let k = 0; k < 3; k++) {
        const a = points[k],
          b = points[(k + 1) % 3];
        if (signed[a] >= 0) out.push(a);
        if (signed[a] >= 0 !== signed[b] >= 0) out.push(cut(a, b));
      }
      for (let k = 1; k < out.length - 1; k++)
        indices.push(out[0], out[k], out[k + 1]);
    };
    for (let z = 0; z < nz; z++)
      for (let x = 0; x < nx; x++) {
        const a = z * (nx + 1) + x;
        triangle(a, a + nx + 1, a + 1);
        triangle(a + 1, a + nx + 1, a + nx + 2);
      }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geometry.setAttribute(
      "waterDepth",
      new THREE.Float32BufferAttribute(depths, 1),
    );
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const water = makeWaterSurface(
      geometry,
      pond.level,
      clock,
    );
    group.add(water);
  }
  group.add(makeTrees(world, env, clock));
  const flows=makeDrainFlow(world,env,clock);
  if(flows.userData.count) group.add(flows);
  else { flows.geometry.dispose(); flows.material.dispose(); }

  const mist: {
    mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
    x: number;
    z: number;
    phase: number;
    strength: number;
  }[] = [];
  const pixels = new Uint8Array(32 * 32 * 4);
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) {
      const d = Math.hypot((x - 15.5) / 15.5, (y - 15.5) / 15.5),
        i = (y * 32 + x) * 4;
      pixels.set(
        [255, 255, 255, Math.round(Math.pow(Math.max(0, 1 - d * d), 3) * 255)],
        i,
      );
    }
  const patches = fogPatches(env);
  if (patches.length) {
    const texture = new THREE.DataTexture(pixels, 32, 32);
    texture.needsUpdate = true;
    const random = randomSequence((world.terrain?.seed ?? 0) ^ 0x517a);
    for (const patch of patches) {
      const {x,z,radius,strength}=patch;
      const material = new THREE.MeshBasicMaterial({map:texture,color:"#ffffff",transparent:true,
        opacity:0,depthWrite:false,side:THREE.DoubleSide});
      const mesh=new THREE.Mesh(new THREE.PlaneGeometry(1,1),material);
      mesh.name="generated-fog";
      mesh.scale.set(radius*4,1.3+random()*.6,1);
      mesh.position.set(sceneCoord(x), Math.max(terrainSample(world,x,z).height,
        env.cells[Math.max(0,Math.min(env.cells.length-1,Math.round(z)*env.size+Math.round(x)))].water ?? -Infinity)+.65,sceneCoord(z));
      group.add(mesh);
      mist.push({mesh,x:mesh.position.x,z:mesh.position.z,phase:random()*6.28,strength});
    }
  }
  let firstTime: number | undefined;
  return {
    group,
    update: (time: number, camera?: THREE.Camera, mistColor?: THREE.Color) => {
      firstTime ??= time;
      const appear = Math.min(1,(time-firstTime)/650);
      for (const fog of mist) {
        fog.mesh.material.opacity = .26 * fog.strength * appear;
        if (mistColor) fog.mesh.material.color.copy(mistColor);
        if (camera) fog.mesh.quaternion.copy(camera.quaternion);
        fog.mesh.position.x =
          fog.x + Math.sin(time * 0.00025 + fog.phase) * 0.3;
        fog.mesh.position.z =
          fog.z + Math.cos(time * 0.00019 + fog.phase) * 0.2;
      }
    },
  };
}
