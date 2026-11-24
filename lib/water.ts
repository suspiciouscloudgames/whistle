import { groundTileHeight, isGap } from "./tile.ts";
import type { World } from "./world.ts";
type Ground = Pick<World, "size" | "terrain">;
export const WATER_INSET = 0.06;
const smooth = (t: number) => {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
};
export function isWaterTile(world: Ground, x: number, z: number) {
  const tile = (a: number, b: number) =>
    a < 0 || b < 0 || a >= world.size || b >= world.size
      ? undefined
      : world.terrain?.tiles[b * world.size + a];
  const wet = (a: number, b: number) => {
    const t = tile(a, b);
    return !!t && !isGap(t) && t.surface === "slick";
  };
  return wet(x, z);
}
export function waterWeights(
  size: number,
  x: number,
  z: number,
  level: (i: number) => number | null,
  hole?: (i: number) => boolean,
) {
  const px = x + .18 * Math.sin(z * 1.37 + x * .43) + .09 * Math.sin(z * 3.1 - x * .71);
  const pz = z + .18 * Math.sin(x * 1.19 - z * .37) + .09 * Math.cos(x * 2.7 + z * .83);
  const radius = 1.18;
  const weights = new Map<number, number>();
  for (let zz = Math.max(0, Math.ceil(pz - radius)); zz <= Math.min(size - 1, Math.floor(pz + radius)); zz++)
    for (let xx = Math.max(0, Math.ceil(px - radius)); xx <= Math.min(size - 1, Math.floor(px + radius)); xx++) {
      const q = 1 - ((px - xx) ** 2 + (pz - zz) ** 2) / (radius * radius);
      if (q <= 0) continue;
      if (hole?.(zz * size + xx)) continue;
      const h = level(zz * size + xx);
      if (h !== null) {
        weights.set(h, Math.min(1, (weights.get(h) ?? 0) + q * q * q));
      }
    }
  return weights;
}
export function waterSupport(ground: number, bankHeight: number) {
  return smooth(1 - Math.abs(ground - bankHeight) / .45);
}
export function waterLevelAt(
  size: number,
  x: number,
  z: number,
  level: (i: number) => number | null,
  hole?: (i: number) => boolean,
  ground?: number,
) {
  const cx = Math.max(0, Math.min(size - 1, x)), cz = Math.max(0, Math.min(size - 1, z));
  const weights = waterWeights(size, ground === undefined ? x : cx, ground === undefined ? z : cz, level, hole);
  if (ground !== undefined) {
    for (const [h, w] of weights)
      if (h > 0 && w > .02 && ground < h - .002 && !hole?.(Math.round(cz) * size + Math.round(cx))) return h;
  }
  const surface = ground !== undefined && (cx !== x || cz !== z) ? waterWeights(size, x, z, level, hole) : weights;
  for (const [h, w] of surface) if (w * (ground === undefined ? 1 : waterSupport(ground, h + WATER_INSET)) > 0.8) return h;
  return null;
}

export function carveWaterBed(
  world: Ground,
  x: number,
  z: number,
  ground: number,
  unit: number,
) {
  const weights = waterWeights(world.size, x, z, (i) =>
    isWaterTile(world, i % world.size, Math.floor(i / world.size))
      ? groundTileHeight(world.terrain!.tiles[i])
      : null,
    (i) => isGap(world.terrain?.tiles[i]),
  );
  for (const [h, weight] of weights) {
    const w = weight * waterSupport(ground, h * unit);
    if (w <= 0.05) continue;

    // Leave a broad, dry rim before the bed drops below the surface.
    const bankBlend = smooth((w - 0.05) / 0.2);

    const bed = h * unit - 0.32 * smooth((w - 0.72) / 0.28)
      - 0.48 * smooth((w - 0.84) / 0.16);
    return ground + (bed - ground) * bankBlend;
  }
  return ground;
}
