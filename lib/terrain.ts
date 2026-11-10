import { isHole } from "./tile.ts";
import type { World, Placed } from "./world.ts";
import { carveWaterBed } from "./water.ts";
export type Surface = "plain" | "rough" | "slick" | "soft";
export type Tile = { height: number; surface: Surface; hole?: boolean };
export type Terrain = {
  generatorVersion?: 2;
  seed: number;
  tiles: Tile[];
  patterns: { stairs: boolean; bridge: boolean; canopy: boolean };
};
export type Structure = {
  kind: "stairs" | "bridge" | "canopy";
  x: number;
  z: number;
  height: number;
  dx: number;
  dz: number;
  key: string;
};
export const SURFACES: {
  id: Surface;
  name: string;
  color: string;
  speed: number;
}[] = [
  { id: "plain", name: "단단한 바닥", color: "#ffffff", speed: 1 },
  { id: "rough", name: "거친 바닥", color: "#ffffff", speed: 0.72 },
  { id: "slick", name: "미끄러운 바닥", color: "#ffffff", speed: 1.2 },
  { id: "soft", name: "부드러운 바닥", color: "#ffffff", speed: 0.62 },
];
export const LEVEL = 1.05;
export function randomSequence(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
export function flatTerrain(size: number): Terrain {
  return {
    generatorVersion: 2,
    seed: 0,
    tiles: Array.from({ length: size * size }, () => ({
      height: 0,
      surface: "plain",
    })),
    patterns: { stairs: true, bridge: true, canopy: true },
  };
}
export function generateTerrain(size: number, seed: number): Terrain {
  const random = randomSequence(seed),
    terrain = flatTerrain(size);
  terrain.seed = seed;
  const centers = Array.from({ length: 4 }, (_, i) => ({
    x: 2 + random() * (size - 4),
    z: 1 + random() * (size - 5),
    height: (i % 2) + 1,
    radius: 1.7 + random() * 1.8,
    surface: SURFACES[i].id,
  }));
  terrain.tiles = terrain.tiles.map((_, i) => {
    const x = i % size,
      z = Math.floor(i / size);
    let tile: Tile = { height: 0, surface: "plain" };
    for (const c of centers) {
      const d = Math.hypot(x - c.x, z - c.z);
      if (d < c.radius)
        tile = {
          height: Math.max(0, c.height - Math.floor(d / 1.4)),
          surface: c.surface,
        };
    }
    return tile;
  });

  for (let z = size - 3; z < size; z++)
    for (let x = 0; x < size; x++)
      terrain.tiles[z * size + x] = { height: 0, surface: "plain" };
  return terrain;
}

export function upgradeTerrain(world: World): World {
  const terrain = world.terrain;
  if (!terrain || terrain.generatorVersion === 2) return world;
  const next = structuredClone(world),
    t = next.terrain!;
  t.generatorVersion = 2;
  const baseline = generateTerrain(world.size, terrain.seed);
  const x = Math.floor(world.size / 2),
    crossing = Math.floor(world.size / 2) - 1;
  const strip = Array.from(
    { length: world.size - 4 },
    (_, i) => (i + 1) * world.size + x,
  );
  const ends = [crossing * world.size + x - 1, crossing * world.size + x + 1];
  const special = new Set([...strip, ...ends]);
  const same = (a: Tile, b: Tile) =>
    a.height === b.height && a.surface === b.surface;
  const intact = terrain.tiles.filter(
    (tile, i) => !special.has(i) && same(tile, baseline.tiles[i]),
  ).length;
  const holes = strip.filter(
    (i) =>
      terrain.tiles[i].height === -1 && terrain.tiles[i].surface === "plain",
  );
  if (
    terrain.seed !== 0 &&
    intact >= (terrain.tiles.length - special.size) * 0.75 &&
    holes.length >= strip.length * 0.6
  ) {
    for (const i of holes) t.tiles[i] = { ...baseline.tiles[i] };
    for (const i of ends)
      if (same(terrain.tiles[i], { height: 1, surface: "plain" }))
        t.tiles[i] = { ...baseline.tiles[i] };
  }
  t.patterns = { stairs: true, bridge: true, canopy: true };
  return next;
}
export function tileAt(
  world: Pick<World, "size" | "terrain">,
  x: number,
  z: number,
): Tile | undefined {
  x = Math.round(x);
  z = Math.round(z);
  if (x < 0 || z < 0 || x >= world.size || z >= world.size) return;
  return (
    world.terrain?.tiles[z * world.size + x] ?? { height: 0, surface: "plain" }
  );
}
export function deriveStructures(
  world: World,
  objects: (Placed & { removed?: boolean })[] = world.objects,
): Structure[] {
  const structures: Structure[] = [],
    patterns = world.terrain?.patterns ?? {
      stairs: true,
      bridge: true,
      canopy: true,
    };
  const add = (
    kind: Structure["kind"],
    x: number,
    z: number,
    height: number,
    dx = 0,
    dz = 0,
  ) => {
    const key = `${kind}:${x}:${z}`;
    if (!structures.some((s) => s.key === key))
      structures.push({ kind, x, z, height, dx, dz, key });
  };
  if (patterns.stairs)
    for (let z = 0; z < world.size; z++)
      for (let x = 0; x < world.size; x++) {
        const tile = tileAt(world, x, z)!;
        if (isHole(tile) || tile.surface !== "plain") continue;
        for (const [dx, dz] of [
          [0, -1],
          [1, 0],
          [0, 1],
          [-1, 0],
        ]) {
          const next = tileAt(world, x + dx, z + dz);
          if (
            next && !isHole(next) &&
            next.height === tile.height + 1 &&
            next.surface === tile.surface
          ) {
            add("stairs", x, z, tile.height, dx, dz);
            break;
          }
        }
      }
  const active = objects.filter((o) => !o.removed),
    byCell = new Map(active.map((o) => [`${o.x},${o.z}`, o]));
  for (const a of active) {
    const tile = tileAt(world, a.x, a.z);
    if (!tile || isHole(tile)) continue;
    if (patterns.bridge)
      for (const [dx, dz] of [
        [1, 0],
        [0, 1],
      ])
        for (let length = 2; length <= 4; length++) {
          const b = byCell.get(`${a.x + dx * length},${a.z + dz * length}`),
            end = tileAt(world, a.x + dx * length, a.z + dz * length);
          if (!b || b.asset !== a.asset || end?.height !== tile.height || isHole(end))
            continue;
          const gaps = Array.from({ length: length - 1 }, (_, i) => ({
            x: a.x + dx * (i + 1),
            z: a.z + dz * (i + 1),
          }));
          if (gaps.every((p) => isHole(tileAt(world, p.x, p.z))))
            for (const p of gaps) add("bridge", p.x, p.z, tile.height, dx, dz);
        }
    if (patterns.canopy) {
      const corners = [
        [a.x + 2, a.z],
        [a.x, a.z + 2],
        [a.x + 2, a.z + 2],
      ];
      if (
        corners.every(
          ([x, z]) =>
            byCell.get(`${x},${z}`)?.asset === a.asset &&
            !!tileAt(world, x, z) && !isHole(tileAt(world, x, z)),
        )
      )
        add(
          "canopy",
          a.x + 1,
          a.z + 1,
          Math.max(
            tile.height,
            ...corners.map(([x, z]) => tileAt(world, x, z)!.height),
          ),
        );
    }
  }
  return structures;
}

export function terrainSample(
  world: Pick<World, "size" | "terrain">,
  x: number,
  z: number,
) {
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const fx = Math.floor(x),
    fz = Math.floor(z),
    tx = smooth(x - fx),
    tz = smooth(z - fz);
  const weights = { plain: 0, rough: 0, slick: 0, soft: 0 };
  let elevation = 0,
    coverage = 0,
    voidAmount = 0;
  for (const [dx, dz, w] of [
    [0, 0, (1 - tx) * (1 - tz)],
    [1, 0, tx * (1 - tz)],
    [0, 1, (1 - tx) * tz],
    [1, 1, tx * tz],
  ]) {
    const tile = tileAt(
      world,
      Math.max(0, Math.min(world.size - 1, fx + dx)),
      Math.max(0, Math.min(world.size - 1, fz + dz)),
    )!;
    if (isHole(tile)) {
      const hx = Math.max(0, Math.min(world.size - 1, fx + dx));
      const hz = Math.max(0, Math.min(world.size - 1, fz + dz));
      const seed =
        ((world.terrain?.seed ?? 0) ^
          Math.imul(hx, 73856093) ^
          Math.imul(hz, 19349663)) >>>
        0;
      const phase = (seed % 6283) / 1000;
      const rim =
        1 +
        0.22 * Math.sin((x - hx) * 6.1 + phase) +
        0.16 * Math.cos((z - hz) * 5.3 - phase * 1.7) +
        0.08 * Math.sin((x + z - hx - hz) * 8.2 + phase * 0.7);
      voidAmount += w * rim;
      continue;
    }
    elevation += tile.height * LEVEL * w;
    coverage += w;
    weights[tile.surface] += w;
  }
  if (coverage > 0) {
    elevation /= coverage;
    for (const surface of SURFACES) weights[surface.id] /= coverage;
  }

  const variation =
    Math.sin(x * 2.31 + z * 1.17) * Math.sin(z * 3.13 - x * 0.73);
  elevation += variation * 0.045 * (weights.soft + weights.rough);
  elevation = carveWaterBed(world, x, z, elevation, LEVEL);


  const outside = Math.max(0, -0.5 - x, -0.5 - z, x - (world.size - 0.5), z - (world.size - 0.5));
  if (outside > 0) {
    const reach = 5.5 + 1.2 * Math.sin(x * .43 + z * .31);
    const fade = smooth(Math.min(1, outside / reach));
    elevation = elevation * (1 - fade)
      + Math.sin(x * .61 + z * .27) * Math.cos(z * .49 - x * .19) * .45 * fade * (1 - fade);
    voidAmount *= 1 - smooth(Math.min(1, outside / 1.5));
  }
  return {
    height: elevation,
    coverage: Math.max(0, Math.min(1, 1 - voidAmount)),
    weights,
  };
}
export function floorHeight(
  world: World,
  x: number,
  z: number,
  structures = deriveStructures(world),
): number | null {

  const outside = Math.max(
    0,
    -0.5 - x,
    -0.5 - z,
    x - (world.size - 0.5),
    z - (world.size - 0.5),
  );
  if (outside > 0) {
    const sample = terrainSample(world, x, z);
    return sample.coverage >= .5 ? sample.height : null;
  }
  const bridge = structures.find(
    (s) =>
      s.kind === "bridge" &&
      Math.abs(s.x - x) <= 0.5 &&
      Math.abs(s.z - z) <= 0.5,
  );
  if (bridge) return bridge.height * LEVEL;
  const sample = terrainSample(world, x, z);
  return sample.coverage >= 0.5 ? sample.height : null;
}
