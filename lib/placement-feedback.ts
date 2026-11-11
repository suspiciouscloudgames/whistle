import type { World } from "./world.ts";
import { deriveStructures, tileAt } from "./terrain.ts";
import { deriveEnvironment } from "./environment.ts";
import { drainSources } from "./environment-effects.ts";
import type { WorldDerivation } from "./world-derivation.ts";

export type CellChange = { index: number; result: boolean; removed: boolean };
export type PlacementFeedback = { id: number; cells: CellChange[] };

function snapshot(world: World, derivation?: WorldDerivation) {
  const structures = derivation?.structures ?? deriveStructures(world);
  const environment = derivation?.environment ?? deriveEnvironment(world, structures);
  const drains = drainSources(world,environment);
  return environment.cells.map((c, i) => {
    const x = i % world.size,
      z = Math.floor(i / world.size);
    const results = [
      c.grass ? "grass" : "",
      ...drains.filter(d=>d.cell===i || d.hole===i).map(d=>`drain:${d.cell}:${d.hole}`),
      c.tree ? "tree" : "",
      c.water === null ? "" : `water:${c.water.toFixed(2)}`,
      c.fog > 0.05 ? `fog:${Math.round(c.fog * 4)}` : "",
      Math.hypot(c.windX, c.windZ) > 0.1 ? `wind:${c.windX},${c.windZ}` : "",
      c.light < 0.7 ? `shade:${Math.round(c.light * 4)}` : "",
      ...structures
        .filter((s) =>
          s.kind === "canopy"
            ? Math.abs(s.x - x) <= 1 && Math.abs(s.z - z) <= 1
            : s.x === x && s.z === z,
        )
        .map((s) => `${s.kind}:${s.height}:${s.dx}:${s.dz}`),
    ]
      .filter(Boolean)
      .sort();
    return {
      results,
      placed: JSON.stringify([
        tileAt(world, x, z),
        world.objects.filter((o) => o.x === x && o.z === z),
      ]),
    };
  });
}


export function placementChanges(
  before: World,
  after: World,
  beforeDerivation?: WorldDerivation,
  afterDerivation?: WorldDerivation,
): CellChange[] {
  if (before.size !== after.size) return [];
  const previous = snapshot(before, beforeDerivation),
    next = snapshot(after, afterDerivation);
  return next.flatMap((cell, index) => {
    const old = previous[index];
    const result = JSON.stringify(old.results) !== JSON.stringify(cell.results);
    if (!result && old.placed === cell.placed) return [];
    const added = cell.results.some((r) => !old.results.includes(r));
    return [{ index, result, removed: result && !added }];
  });
}


export function feedbackRegions(cells: CellChange[], size: number) {
  const remaining = new Set(cells.map((c) => c.index));
  const regions: { x: number; z: number; radius: number; indices: number[] }[] =
    [];
  while (remaining.size) {
    const seed = remaining.values().next().value!;
    remaining.delete(seed);
    const group = [seed];
    for (let n = 0; n < group.length; n++) {
      const i = group[n],
        x = i % size,
        z = Math.floor(i / size);
      for (const [nx, nz] of [
        [x - 1, z],
        [x + 1, z],
        [x, z - 1],
        [x, z + 1],
      ]) {
        const j = nz * size + nx;
        if (nx >= 0 && nx < size && nz >= 0 && nz < size && remaining.delete(j))
          group.push(j);
      }
    }
    const x = group.reduce((sum, i) => sum + (i % size), 0) / group.length;
    const z =
      group.reduce((sum, i) => sum + Math.floor(i / size), 0) / group.length;
    const radius =
      Math.max(
        ...group.map((i) =>
          Math.hypot((i % size) - x, Math.floor(i / size) - z),
        ),
      ) + 0.65;
    regions.push({ x, z, radius, indices: group });
  }
  return regions
    .sort((a, b) => b.indices.length - a.indices.length)
    .slice(0, 12);
}
