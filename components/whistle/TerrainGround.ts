import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { terrainSample } from "../../lib/terrain.ts";
import { waterWeights, waterSupport, WATER_INSET } from "../../lib/water.ts";
import type { World } from "../../lib/world.ts";
import type { Environment } from "../../lib/environment.ts";

type Chunk = {key:string; ground:THREE.BufferGeometry; bank:THREE.BufferGeometry};
export const createTerrainCache = () => new Map<string,Chunk>();
type Bounds = {x:number; z:number; length:number};
function buildGround(world:World, environment:Environment, hasWaterTiles:boolean, bounds?:Bounds) {
  const group = new THREE.Group();
  const toScene = (n:number) => n * 2 - world.size + 1;
  const palette = {
    plain: new THREE.Color("#ffffff"),
    rough: new THREE.Color("#ffffff"),
    slick: new THREE.Color("#ffffff"),
    soft: new THREE.Color("#ffffff"),
  };


  const extent = world.size + 3;
  const resolution = bounds ? bounds.length + 2 : (world.size + 3) * 12,
    stride = resolution + 1;
  const positions: number[] = [],
    colors: number[] = [],
    indices: number[] = [],
    coverage: number[] = [],
    wetness: number[] = [], natural: number[] = [];
  const sampleColor = new THREE.Color();
  const hasPonds = environment.ponds.length > 0;
  for (let z = 0; z <= resolution; z++)
    for (let x = 0; x <= resolution; x++) {
      const gx = (x + (bounds ? bounds.x - 1 : 0)) / 12 - 2,
        gz = (z + (bounds ? bounds.z - 1 : 0)) / 12 - 2,
        sample = terrainSample(world, gx, gz, hasWaterTiles);
      positions.push(toScene(gx), sample.height, toScene(gz));
      coverage.push(sample.coverage);
      if (hasPonds) {
        natural.push(sample.naturalHeight);
        let wet = 0;
        for (const [level, weight] of waterWeights(world.size, gx, gz, i => environment.cells[i].water, i => environment.cells[i].hole))
          wet = Math.max(wet, weight * waterSupport(sample.naturalHeight, level + WATER_INSET));
        wetness.push(wet);
      }
      colors.push(1, 1, 1);
    }

  const boundary = new Map<string, [number, number]>();
  const edge = (a: number, b: number) => {
    if (coverage[a] !== 0.5 || coverage[b] !== 0.5) return;
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (boundary.has(key)) boundary.delete(key);
    else boundary.set(key, [a, b]);
  };
  const cuts = new Map<string, number>();
  const cut = (a: number, b: number) => {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    const existing = cuts.get(key);
    if (existing !== undefined) return existing;
    const t = (0.5 - coverage[a]) / (coverage[b] - coverage[a]),
      i = coverage.length;
    for (let axis = 0; axis < 3; axis++) {
      positions.push(
        positions[a * 3 + axis] +
          (positions[b * 3 + axis] - positions[a * 3 + axis]) * t,
      );
      colors.push(
        colors[a * 3 + axis] +
          (colors[b * 3 + axis] - colors[a * 3 + axis]) * t,
      );
    }
    coverage.push(0.5);
    cuts.set(key, i);
    return i;
  };
  const midpoints = new Map<string, number>();
  const midpoint = (a: number, b: number) => {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    const cached = midpoints.get(key);
    if (cached !== undefined) return cached;
    const x = (positions[a * 3] + positions[b * 3]) / 2;
    const z = (positions[a * 3 + 2] + positions[b * 3 + 2]) / 2;
    const sample = terrainSample(
      world,
      (x + world.size - 1) / 2,
      (z + world.size - 1) / 2,
      hasWaterTiles,
    );
    const i = coverage.length;
    positions.push(x, sample.height, z);
    for (let k = 0; k < 3; k++)
      colors.push((colors[a * 3 + k] + colors[b * 3 + k]) / 2);
    coverage.push(sample.coverage);
    midpoints.set(key, i);
    return i;
  };
  const triangle = (a: number, b: number, c: number, refine = true) => {

    const min = Math.min(coverage[a], coverage[b], coverage[c]);
    if (min > 0.5) {
      indices.push(a, b, c);
      return;
    }
    if (Math.max(coverage[a], coverage[b], coverage[c]) < 0.5) return;
    if (refine && min < 0.5) {
      const ab = midpoint(a, b),
        bc = midpoint(b, c),
        ca = midpoint(c, a);
      triangle(a, ab, ca, false);
      triangle(ab, b, bc, false);
      triangle(ca, bc, c, false);
      triangle(ab, bc, ca, false);
      return;
    }
    const input = [a, b, c],
      polygon: number[] = [];
    for (let i = 0; i < 3; i++) {
      const from = input[i],
        to = input[(i + 1) % 3],
        inside = coverage[from] >= 0.5,
        nextInside = coverage[to] >= 0.5;
      if (inside) polygon.push(from);
      if (inside !== nextInside) polygon.push(cut(from, to));
    }
    for (let i = 1; i < polygon.length - 1; i++) {
      const [x, y, z] = [polygon[0], polygon[i], polygon[i + 1]];
      indices.push(x, y, z);
      edge(x, y);
      edge(y, z);
      edge(z, x);
    }
  };
  // Resolve narrow banks only where a water boundary crosses an elevation slope.
  const detailed = new Set<number>();
  if (hasPonds) for (let z = 0; z < resolution; z++) for (let x = 0; x < resolution; x++) {
    const a = z * stride + x, b = a + 1, c = a + stride, d = c + 1;
    if (Math.max(wetness[a], wetness[b], wetness[c], wetness[d]) <= .05 ||
        Math.min(wetness[a], wetness[b], wetness[c], wetness[d]) >= .98) continue;
    const highest = Math.max(natural[a], natural[b], natural[c], natural[d]);
    const lowest = Math.min(natural[a], natural[b], natural[c], natural[d]);
    if (highest - lowest > .025) detailed.add(z * resolution + x);
  }
  const refined = new Map<string, number>();
  const vertex = (x: number, z: number) => {
    if (Number.isInteger(x) && Number.isInteger(z)) return z * stride + x;
    const key = `${x}:${z}`, found = refined.get(key);
    if (found !== undefined) return found;
    const gx = (x + (bounds ? bounds.x - 1 : 0)) / 12 - 2, gz = (z + (bounds ? bounds.z - 1 : 0)) / 12 - 2, sample = terrainSample(world, gx, gz, hasWaterTiles), i = coverage.length;
    positions.push(toScene(gx), sample.height, toScene(gz)); colors.push(1, 1, 1); coverage.push(sample.coverage);
    refined.set(key, i); return i;
  };
  const fine = (x: number, z: number) => x >= 0 && z >= 0 && x < resolution && z < resolution && detailed.has(z * resolution + x);
  const subdivisions = 4;
  const interior: number[] = [];
  for (let z = 0; z < resolution; z++) for (let x = 0; x < resolution; x++) {
    const begin = indices.length;
    if (fine(x, z)) {
      for (let iz = 0; iz < subdivisions; iz++) for (let ix = 0; ix < subdivisions; ix++) {
        const xx = x + ix / subdivisions, zz = z + iz / subdivisions, step = 1 / subdivisions;
        const a = vertex(xx, zz), b = vertex(xx + step, zz), c = vertex(xx, zz + step), d = vertex(xx + step, zz + step);
        triangle(a, c, b); triangle(b, c, d);
      }
    } else if (fine(x - 1, z) || fine(x + 1, z) || fine(x, z - 1) || fine(x, z + 1)) {
      // Share boundary vertices with finer neighbours instead of leaving cracks.
      const ring: number[] = [];
      for (const [ax, az, bx, bz, split] of [[x,z,x,z+1,fine(x-1,z)], [x,z+1,x+1,z+1,fine(x,z+1)],
        [x+1,z+1,x+1,z,fine(x+1,z)], [x+1,z,x,z,fine(x,z-1)]] as [number,number,number,number,boolean][]) {
        const steps = split ? subdivisions : 1;
        for (let k = 0; k < steps; k++) ring.push(vertex(ax + (bx-ax)*k/steps, az + (bz-az)*k/steps));
      }
      const center = vertex(x + .5, z + .5);
      for (let k = 0; k < ring.length; k++) triangle(center, ring[k], ring[(k+1)%ring.length]);
    } else {
      const a = z * stride + x;
      triangle(a, a + stride, a + 1); triangle(a + 1, a + stride, a + stride + 1);
    }
    if (bounds && x > 0 && z > 0 && x < resolution - 1 && z < resolution - 1)
      for (let i = begin; i < indices.length; i++) interior.push(indices[i]);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  if (bounds) geometry.setIndex(interior);
  const ground = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.86,
      metalness: 0.02,
    }),
  );
  ground.receiveShadow = true;
  ground.castShadow = true;
  ground.name = "continuous-ground";
  ground.userData.interactionOccluder = true;
    group.add(ground);

  if (!world.terrain?.floating) {
  const apronPositions: number[] = [],
    apronColors: number[] = [],
    apronIndices: number[] = [];
  const rings = [0, .5, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 16, 24, 40, 120];
  for (let side = 0; side < 4; side++) {
    const offset = apronPositions.length / 3;
    for (const distance of rings)
      for (let i = 0; i <= resolution; i++) {
        const t = i / resolution,
          ringExtent = extent + distance;
        let x = 0,
          z = 0;
        if (side === 0) {
          x = -ringExtent + 2 * ringExtent * t;
          z = -ringExtent;
        }
        if (side === 1) {
          x = ringExtent;
          z = -ringExtent + 2 * ringExtent * t;
        }
        if (side === 2) {
          x = ringExtent - 2 * ringExtent * t;
          z = ringExtent;
        }
        if (side === 3) {
          x = -ringExtent;
          z = ringExtent - 2 * ringExtent * t;
        }
        const gx = (x + world.size - 1) / 2,
          gz = (z + world.size - 1) / 2;
        const sample = terrainSample(world, gx, gz, hasWaterTiles);
        const f = Math.min(1, distance / 5),
          blend = f * f * (3 - 2 * f);
        apronPositions.push(x, sample.height, z);
        sampleColor.setRGB(0, 0, 0);
        for (const name of ["plain", "rough", "slick", "soft"] as const) {
          sampleColor.r += palette[name].r * sample.weights[name];
          sampleColor.g += palette[name].g * sample.weights[name];
          sampleColor.b += palette[name].b * sample.weights[name];
        }
        if (sample.coverage < 0.5) sampleColor.copy(palette.plain);
        sampleColor.lerp(palette.plain, blend);
        apronColors.push(sampleColor.r, sampleColor.g, sampleColor.b);
      }
    for (let r = 0; r < rings.length - 1; r++)
      for (let i = 0; i < resolution; i++) {
        const a = offset + r * stride + i,
          b = a + 1,
          c = a + stride,
          d = c + 1;
        apronIndices.push(a, b, c, b, d, c);
      }
  }
  const apronGeometry = new THREE.BufferGeometry();
  apronGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(apronPositions, 3),
  );
  apronGeometry.setAttribute(
    "color",
    new THREE.Float32BufferAttribute(apronColors, 3),
  );
  apronGeometry.setIndex(apronIndices);
  apronGeometry.computeVertexNormals();
  const apron = new THREE.Mesh(
    apronGeometry,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.86,
      side: THREE.DoubleSide,
    }),
  );
  apron.receiveShadow = true;
  apron.name = "distant-ground";
  apron.userData.interactionOccluder = true;
    group.add(apron);
  }
  const sides: number[] = [];
  for (const [a, b] of boundary.values()) {
    const ax = positions[a * 3],
      ay = positions[a * 3 + 1],
      az = positions[a * 3 + 2],
      bx = positions[b * 3],
      by = positions[b * 3 + 1],
      bz = positions[b * 3 + 2];
    if (bounds) {
      const x = ((ax + bx) / 2 + world.size - 1) * 6 + 24;
      const z = ((az + bz) / 2 + world.size - 1) * 6 + 24;
      if (x < bounds.x || z < bounds.z || x >= bounds.x + bounds.length || z >= bounds.z + bounds.length) continue;
    }
    if (
      (Math.abs(ax) === extent && ax === bx) ||
      (Math.abs(az) === extent && az === bz)
    )
      continue;
    sides.push(
      ax,
      ay,
      az,
      ax,
      world.terrain?.floating ? ay - .22 : -18,
      az,
      bx,
      by,
      bz,
      bx,
      by,
      bz,
      ax,
      world.terrain?.floating ? ay - .22 : -18,
      az,
      bx,
      world.terrain?.floating ? by - .22 : -18,
      bz,
    );
  }
  const skirt = new THREE.BufferGeometry();
  skirt.setAttribute("position", new THREE.Float32BufferAttribute(sides, 3));
  skirt.computeVertexNormals();
  const wallColors: number[] = [];
  for (let i = 0; i < sides.length; i += 3) {
    const shade =
      0.06 + 0.7 * Math.max(0, Math.min(1, (sides[i + 1] + 18) / 20));
    wallColors.push(shade, shade, shade);
  }
  skirt.setAttribute("color", new THREE.Float32BufferAttribute(wallColors, 3));
  const bank = new THREE.Mesh(
    skirt,
    new THREE.MeshStandardMaterial({
      color: "#ffffff",
      vertexColors: true,
      roughness: 1,
      side: THREE.DoubleSide,
    }),
  );
  bank.receiveShadow = true;
  bank.name = "terrain-bank";
  bank.userData.interactionOccluder = true;
    group.add(bank);
  return {group,geometry};
}

export function makeGround(world:World, environment:Environment, cache?:ReturnType<typeof createTerrainCache>) {
  const hasWaterTiles = world.terrain?.tiles.some(tile => tile.surface === "slick") ?? false;
  if (!cache || !world.terrain?.floating || world.size <= 12) return buildGround(world,environment,hasWaterTiles);
  const grounds:THREE.BufferGeometry[] = [], banks:THREE.BufferGeometry[] = [];
  const length = 48, total = (world.size + 3) * 12;
  for (let z = 0; z < total; z += length) for (let x = 0; x < total; x += length) {
    const local:unknown[] = [world.size,world.terrain.seed];
    // Water influence and coverage extend beyond the chunk, including its normal halo.
    for (let zz = Math.max(0,z/12-5); zz <= Math.min(world.size-1,(z+length)/12+1); zz++)
      for (let xx = Math.max(0,x/12-5); xx <= Math.min(world.size-1,(x+length)/12+1); xx++) {
        const i = zz*world.size+xx;
        local.push(world.terrain.tiles[i],environment.cells[i].water,environment.cells[i].hole);
      }
    const key = JSON.stringify(local), id = `${x}:${z}`;
    let chunk = cache.get(id);
    if (chunk?.key !== key) {
      chunk?.ground.dispose(); chunk?.bank.dispose();
      const result = buildGround(world,environment,hasWaterTiles,{x,z,length});
      const ground = result.group.getObjectByName("continuous-ground") as THREE.Mesh<THREE.BufferGeometry,THREE.Material>;
      const bank = result.group.getObjectByName("terrain-bank") as THREE.Mesh<THREE.BufferGeometry,THREE.Material>;
      chunk = {key,ground:ground.geometry,bank:bank.geometry};
      ground.material.dispose();bank.material.dispose();cache.set(id,chunk);
    }
    grounds.push(chunk!.ground); banks.push(chunk!.bank);
  }
  const geometry = mergeGeometries(grounds)!;
  const ground = new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.86,metalness:.02}));
  ground.name = "continuous-ground";ground.receiveShadow = ground.castShadow = true;ground.userData.interactionOccluder = true;
  const bank = new THREE.Mesh(mergeGeometries(banks)!,new THREE.MeshStandardMaterial({color:"#ffffff",vertexColors:true,roughness:1,side:THREE.DoubleSide}));
  bank.name = "terrain-bank";bank.receiveShadow = true;bank.userData.interactionOccluder = true;
  const group = new THREE.Group();group.add(ground,bank);
  return {group,geometry};
}
