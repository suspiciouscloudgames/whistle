import * as THREE from "three";
import { deriveEnvironment, environmentAt } from "../../lib/environment.ts";
import { makeEnvironment } from "./EnvironmentScene.ts";
import { makeGrass } from "./Grass.ts";
import type { World } from "@/lib/world";
import {
  LEVEL,
  randomSequence,
  terrainSample,
  type Structure,
} from "../../lib/terrain.ts";

// A continuous height field with blended materials, independent of the editor grid.
export function makeTerrain(world: World, structures: Structure[]) {
  const group = new THREE.Group(),
    wind = { value: 0 };
  const environment = deriveEnvironment(world, structures);
  const toScene = (n: number) => n * 2 - world.size + 1;
  const random = randomSequence(world.terrain?.seed ?? 0);
  const palette = {
    plain: new THREE.Color("#ffffff"),
    rough: new THREE.Color("#ffffff"),
    slick: new THREE.Color("#ffffff"),
    soft: new THREE.Color("#ffffff"),
  };
  const resolution = world.size * 12,
    stride = resolution + 1;
  const positions: number[] = [],
    colors: number[] = [],
    indices: number[] = [],
    coverage: number[] = [];
  const sampleColor = new THREE.Color();
  for (let z = 0; z <= resolution; z++)
    for (let x = 0; x <= resolution; x++) {
      const gx = x / 12 - 0.5,
        gz = z / 12 - 0.5,
        sample = terrainSample(world, gx, gz);
      positions.push(toScene(gx), sample.height, toScene(gz));
      coverage.push(sample.coverage);
      sampleColor.setRGB(0, 0, 0);
      for (const name of ["plain", "rough", "slick", "soft"] as const) {
        sampleColor.r += palette[name].r * sample.weights[name];
        sampleColor.g += palette[name].g * sample.weights[name];
        sampleColor.b += palette[name].b * sample.weights[name];
      }
      const grain =
        1 +
        Math.sin(gx * 7.3 + gz * 2.1) *
          Math.sin(gz * 6.2 - gx) *
          0.018 *
          (sample.weights.rough + sample.weights.soft);
      sampleColor.multiplyScalar(
        grain * (0.55 + 0.45 * environmentAt(environment, gx, gz).light),
      );
      colors.push(sampleColor.r, sampleColor.g, sampleColor.b);
    }
  // Clip triangles to the curved gap contour, rather than omitting square tiles.
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
    // Only refine the rim, keeping the rest of the mobile terrain mesh light.
    if (
      refine &&
      Math.min(coverage[a], coverage[b], coverage[c]) < 0.5 &&
      Math.max(coverage[a], coverage[b], coverage[c]) >= 0.5
    ) {
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
  for (let z = 0; z < resolution; z++)
    for (let x = 0; x < resolution; x++) {
      const a = z * stride + x,
        b = a + 1,
        c = a + stride,
        d = c + 1;
      triangle(a, c, b);
      triangle(b, c, d);
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
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
  group.add(ground);
  // Continue the surface beyond the editable area. No square plinth in 3D.
  const apronPositions: number[] = [],
    apronColors: number[] = [],
    apronIndices: number[] = [];
  const rings = [0, 0.75, 2, 5, 12, 40, 120];
  for (let side = 0; side < 4; side++) {
    const offset = apronPositions.length / 3;
    for (const distance of rings)
      for (let i = 0; i <= resolution; i++) {
        const t = i / resolution,
          extent = world.size + distance;
        let x = 0,
          z = 0;
        if (side === 0) {
          x = -extent + 2 * extent * t;
          z = -extent;
        }
        if (side === 1) {
          x = extent;
          z = -extent + 2 * extent * t;
        }
        if (side === 2) {
          x = extent - 2 * extent * t;
          z = extent;
        }
        if (side === 3) {
          x = -extent;
          z = extent - 2 * extent * t;
        }
        const gx = (x + world.size - 1) / 2,
          gz = (z + world.size - 1) / 2;
        const sample = terrainSample(
          world,
          Math.max(-0.5, Math.min(world.size - 0.5, gx)),
          Math.max(-0.5, Math.min(world.size - 0.5, gz)),
        );
        const f = Math.min(1, distance / 5),
          blend = f * f * (3 - 2 * f);
        apronPositions.push(x, sample.height * (1 - blend), z);
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
  group.add(apron);
  const sides: number[] = [];
  for (const [a, b] of boundary.values()) {
    const ax = positions[a * 3],
      ay = positions[a * 3 + 1],
      az = positions[a * 3 + 2],
      bx = positions[b * 3],
      by = positions[b * 3 + 1],
      bz = positions[b * 3 + 2];
    if (
      (Math.abs(ax) === world.size && ax === bx) ||
      (Math.abs(az) === world.size && az === bz)
    )
      continue;
    sides.push(
      ax,
      ay,
      az,
      ax,
      -18,
      az,
      bx,
      by,
      bz,
      bx,
      by,
      bz,
      ax,
      -18,
      az,
      bx,
      -18,
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
  group.add(bank);
  if (world.terrain?.tiles.some((t) => t.height < 0)) {
    const bottom = new THREE.Mesh(
      new THREE.PlaneGeometry(world.size * 2, world.size * 2),
      new THREE.MeshStandardMaterial({ color: "#121519", roughness: 1 }),
    );
    bottom.name = "hole-bottom";
    bottom.rotation.x = -Math.PI / 2;
    bottom.position.y = -18;
    group.add(bottom);
  }

  const architecture: {
    x: number;
    y: number;
    z: number;
    w: number;
    h: number;
    d: number;
  }[] = [];
  for (const s of structures) {
    const x = toScene(s.x),
      z = toScene(s.z),
      y = s.height * LEVEL;
    if (s.kind === "stairs") {
      // Treads follow the actual slope, reaching the next landform without a tile pedestal.
      for (let step = 0; step < 8; step++) {
        const t = (step + 0.5) / 8,
          gx = s.x + s.dx * t,
          gz = s.z + s.dz * t;
        const elevation = terrainSample(world, gx, gz).height;
        const bottom = y - 0.35;
        architecture.push({
          x: toScene(gx),
          z: toScene(gz),
          y: (elevation + 0.025 + bottom) / 2,
          w: s.dx ? 0.25 : 2,
          d: s.dz ? 0.25 : 2,
          h: elevation + 0.025 - bottom,
        });
      }
    }
    if (s.kind === "bridge") {
      architecture.push({ x, z, y: y - 0.09, w: 2, d: 2, h: 0.18 });
      for (const side of [-1, 1])
        architecture.push({
          x: x + s.dz * side * 0.94,
          z: z + s.dx * side * 0.94,
          y: y + 0.38,
          w: s.dx ? 2 : 0.06,
          d: s.dz ? 2 : 0.06,
          h: 0.06,
        });
    }
    if (s.kind === "canopy") {
      architecture.push({ x, z, y: y + 3.25, w: 4.8, d: 4.8, h: 0.16 });
      for (const dx of [-2, 2])
        for (const dz of [-2, 2]) {
          const base = terrainSample(world, s.x + dx / 2, s.z + dz / 2).height;
          architecture.push({
            x: x + dx,
            z: z + dz,
            y: (y + 3.25 + base) / 2,
            w: 0.1,
            d: 0.1,
            h: y + 3.25 - base,
          });
        }
    }
  }
  const matrix = new THREE.Matrix4(),
    p = new THREE.Vector3(),
    q = new THREE.Quaternion(),
    scale = new THREE.Vector3();
  if (architecture.length) {
    const built = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.8 }),
      architecture.length,
    );
    architecture.forEach((b, i) => {
      matrix.compose(p.set(b.x, b.y, b.z), q, scale.set(b.w, b.h, b.d));
      built.setMatrixAt(i, matrix);
    });
    built.castShadow = built.receiveShadow = true;
    group.add(built);
  }

  // Scatter across the blended region, never as a repeated clump per tile.
  const pebbles: {
    x: number;
    y: number;
    z: number;
    size: number;
    angle: number;
  }[] = [];
  const hasScatter = world.terrain?.tiles.some(
    (t) => t.height >= 0 && t.surface === "rough",
  );
  const attempts = hasScatter
    ? Math.min(world.size * world.size * 750, 90000)
    : 0;
  for (let n = 0; n < attempts; n++) {
    const x = random() * world.size - 0.5,
      z = random() * world.size - 0.5,
      sample = terrainSample(world, x, z);
    if (sample.coverage < 0.6) continue;
    const onStairs = structures.some(
      (s) =>
        s.kind === "stairs" &&
        Math.abs(x - (s.x + s.dx * 0.5)) < 0.55 &&
        Math.abs(z - (s.z + s.dz * 0.5)) < 0.55,
    );
    if (onStairs) continue;
    if (sample.weights.rough > 0.5 && random() < 0.01 && pebbles.length < 240)
      pebbles.push({
        x: toScene(x),
        y: sample.height,
        z: toScene(z),
        size: 0.06 + random() * 0.2,
        angle: random() * 6.28,
      });
  }
  if (pebbles.length) {
    const rockGeometry = new THREE.SphereGeometry(1, 24, 16),
      rockPositions = rockGeometry.getAttribute("position");
    for (let i = 0; i < rockPositions.count; i++) {
      const x = rockPositions.getX(i),
        y = rockPositions.getY(i),
        z = rockPositions.getZ(i);
      const f = 1 + Math.sin(x * 5 + z * 3) * 0.14;
      rockPositions.setXYZ(i, x * f, y * 0.65, z * f);
    }
    rockGeometry.computeVertexNormals();
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
    const rocks = new THREE.InstancedMesh(
      rockGeometry,
      new THREE.MeshStandardMaterial({
        color: "#777777",
        roughness: 0.92,
        bumpMap: stoneGrain,
        bumpScale: 0.025,
      }),
      pebbles.length,
    );
    pebbles.forEach((r, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r.angle);
      matrix.compose(
        p.set(r.x, r.y + r.size * 0.25, r.z),
        q,
        scale.set(r.size, r.size, r.size * 0.85),
      );
      rocks.setMatrixAt(i, matrix);
    });
    rocks.castShadow = rocks.receiveShadow = true;
    group.add(rocks);
  }
  group.add(makeGrass(world, structures, geometry, wind, environment));
  const generated = makeEnvironment(world, environment, wind);
  group.add(generated.group);
  return {
    group,
    environment,
    update: (time: number, camera?: THREE.Camera, mistColor?: THREE.Color) => {
      wind.value = time / 1000;
      generated.update(time, camera, mistColor);
    },
  };
}
