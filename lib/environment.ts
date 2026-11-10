import { isHole } from "./tile.ts";
import type { World } from "./world.ts";
import { isWaterTile, WATER_INSET, waterLevelAt } from "./water.ts";
import {
  deriveStructures,
  LEVEL,
  terrainSample,
  type Structure,
} from "./terrain.ts";

export type EnvironmentCell = {
  hole: boolean;
  growth: number;
  grass: number;
  water: number | null;
  moisture: number;
  light: number;
  windX: number;
  windZ: number;
  fog: number;
  tree: boolean;
};
export type Environment = {
  size: number;
  cells: EnvironmentCell[];
  trees: { x: number; z: number; height: number }[];
  ponds: { cells: number[]; level: number }[];
};
const directions = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
export function deriveEnvironment(
  world: World,
  structures: Structure[] = deriveStructures(world),
): Environment {
  const size = world.size,
    count = size * size;
  const tiles =
    world.terrain?.tiles ??
    Array.from({ length: count }, () => ({ height: 0, surface: "plain" }));
  const index = (x: number, z: number) =>
    x < 0 || z < 0 || x >= size || z >= size ? -1 : z * size + x;
  const adjacent = (i: number) =>
    directions
      .map(([x, z]) => index((i % size) + x, Math.floor(i / size) + z))
      .filter((n) => n >= 0);
  const height = (x: number, z: number) => {
    const tile = tiles[index(x, z)];
    return !tile || isHole(tile) ? -Infinity : tile.height;
  };
  const cells: EnvironmentCell[] = tiles.map((tile) => ({
    hole: isHole(tile),
    growth: 0,
    grass: 0,
    water: null,
    moisture:
      tile.surface === "soft" ? 0.65 : tile.surface === "slick" ? 0.85 : 0,
    light: 1,
    windX: 0,
    windZ: 0,
    fog: 0,
    tree: false,
  }));
  const components = (eligible: (i: number) => boolean) => {
    const seen = new Uint8Array(count),
      result: number[][] = [];
    for (let i = 0; i < count; i++) {
      if (seen[i] || !eligible(i)) continue;
      const group = [i];
      seen[i] = 1;
      for (let cursor = 0; cursor < group.length; cursor++)
        for (const n of adjacent(group[cursor]))
          if (!seen[n] && eligible(n)) {
            seen[n] = 1;
            group.push(n);
          }
      result.push(group);
    }
    return result;
  };
  const ponds: Environment["ponds"] = [];

  for (const elevation of new Set(
    tiles.filter((t) => !isHole(t) && t.height <= 0).map((t) => t.height),
  )) {
    for (const group of components(
      (i) =>
        tiles[i].height === elevation &&
        isWaterTile(world, i % size, Math.floor(i / size)),
    )) {
      const level = elevation * LEVEL - WATER_INSET;
      for (const i of group) {
        cells[i].water = level;
        cells[i].moisture = 1;
      }
      ponds.push({ cells: group, level });
    }
  }

  for (let i = 0; i < count; i++) {
    if (isHole(tiles[i])) continue;
    const x = i % size,
      z = Math.floor(i / size),
      h = tiles[i].height;
    let shade = 0;
    for (const [dx, dz] of [
      ...directions,
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ]) {
      let obstruction = 0;
      for (let d = 1; d <= 3; d++)
        obstruction = Math.max(
          obstruction,
          (height(x + dx * d, z + dz * d) - h) / d,
        );
      shade += Math.min(1, Math.max(0, obstruction));
    }
    cells[i].light = Math.max(0.18, 1 - (shade / 8) * 0.82);
    for (const s of structures)
      if (
        s.kind === "canopy" &&
        Math.abs(x - s.x) <= 1 &&
        Math.abs(z - s.z) <= 1
      )
        cells[i].light *= 0.45;
    if (adjacent(i).some((n) => cells[n].water !== null && h * LEVEL <= cells[n].water! + .24))
      cells[i].moisture = Math.max(0.8, cells[i].moisture);
  }

  for (const axis of [0, 1]) {
    const candidate = (x: number, z: number) => {
      const i = index(x, z);
      if (i < 0 || isHole(tiles[i])) return false;
      const h = tiles[i].height;
      return axis === 0
        ? height(x, z - 1) > h && height(x, z + 1) > h
        : height(x - 1, z) > h && height(x + 1, z) > h;
    };
    for (let z = 0; z < size; z++)
      for (let x = 0; x < size; x++) {
        if (
          !candidate(x, z) ||
          candidate(x - (axis === 0 ? 1 : 0), z - (axis === 1 ? 1 : 0))
        )
          continue;
        const run: number[] = [];
        for (let d = 0; d < size; d++) {
          const xx = x + (axis === 0 ? d : 0),
            zz = z + (axis === 1 ? d : 0);
          if (!candidate(xx, zz)) break;
          run.push(index(xx, zz));
        }
        if (run.length < 3) continue;
        const start = run[0],
          end = run[run.length - 1],
          sx = start % size,
          sz = Math.floor(start / size),
          ex = end % size,
          ez = Math.floor(end / size);
        const before = height(
            sx - (axis === 0 ? 1 : 0),
            sz - (axis === 1 ? 1 : 0),
          ),
          after = height(ex + (axis === 0 ? 1 : 0), ez + (axis === 1 ? 1 : 0));
        if (before > tiles[start].height || after > tiles[end].height) continue;
        for (let d = -2; d < run.length + 2; d++) {
          const i = index(x + (axis === 0 ? d : 0), z + (axis === 1 ? d : 0));
          if (i < 0 || isHole(tiles[i])) continue;
          const strength = d < 0 || d >= run.length ? 0.4 : 0.9;
          if (axis === 0) cells[i].windX = strength;
          else cells[i].windZ = -strength;
        }
      }
  }
  const trees: Environment["trees"] = [];
  for (const group of components(
    (i) =>
      tiles[i].surface === "soft" &&
      !isHole(tiles[i]) &&
      cells[i].water === null,
  )) {
    if (group.length < 3) continue;
    for (const i of group) if (cells[i].light > 0.2) {
      cells[i].grass = 1;
      cells[i].growth = Math.min(1, (group.length - 3) / 21);
    }
    if (group.length < 6) continue;

    const candidates = group
      .filter(
        (i) =>
          cells[i].light > 0.35 &&
          adjacent(i).filter((n) => cells[n].grass > 0).length >= 3,
      )
      .sort((a, b) => tiles[b].height - tiles[a].height || a - b);
    for (const i of candidates) {
      const x = i % size,
        z = Math.floor(i / size);
      if (
        trees.length >= 48 ||
        trees.some((t) => Math.hypot(t.x - x, t.z - z) < 1.4)
      )
        continue;
      cells[i].tree = true;
      trees.push({ x, z, height: terrainSample(world, x, z).height });
    }
  }

  for (let i = 0; i < count; i++) {
    if (isHole(tiles[i])) continue;
    const x = i % size,
      z = Math.floor(i / size);
    for (const tree of trees) {
      const d = Math.hypot(tree.x - x, tree.z - z);
      if (d < 1.25) cells[i].light *= 0.45 + (0.55 * d) / 1.25;
    }
    const c = cells[i],
      breeze = Math.hypot(c.windX, c.windZ);
    if (c.moisture >= 0.8 && c.light < 0.72 && breeze < 0.5)
      c.fog = Math.min(1, (0.72 - c.light) * 2.4) * (1 - breeze);
  }
  return { size, cells, trees, ponds };
}
export function environmentAt(
  env: Environment,
  x: number,
  z: number,
): EnvironmentCell {
  const empty: EnvironmentCell = {
    hole: false,
    growth: 0,
    grass: 0,
    water: null,
    moisture: 0,
    light: 1,
    windX: 0,
    windZ: 0,
    fog: 0,
    tree: false,
  };
  if (x < -0.5 || z < -0.5 || x > env.size - 0.5 || z > env.size - 0.5)
    return { ...empty, water: waterLevelAt(env.size, x, z, (i) => env.cells[i].water, (i) => env.cells[i].hole) };
  const fx = Math.floor(x),
    fz = Math.floor(z),
    smooth = (t: number) => t * t * (3 - 2 * t),
    tx = smooth(x - fx),
    tz = smooth(z - fz);
  const out = { ...empty, light: 0 };
  for (const [dx, dz, w] of [
    [0, 0, (1 - tx) * (1 - tz)],
    [1, 0, tx * (1 - tz)],
    [0, 1, (1 - tx) * tz],
    [1, 1, tx * tz],
  ]) {
    const xx = Math.max(0, Math.min(env.size - 1, fx + dx)),
      zz = Math.max(0, Math.min(env.size - 1, fz + dz)),
      c = env.cells[zz * env.size + xx];
    for (const key of [
      "grass",
      "growth",
      "moisture",
      "light",
      "windX",
      "windZ",
      "fog",
    ] as const)
      out[key] += c[key] * w;
  }
  out.water = waterLevelAt(env.size, x, z, (i) => env.cells[i].water, (i) => env.cells[i].hole);
  return out;
}
