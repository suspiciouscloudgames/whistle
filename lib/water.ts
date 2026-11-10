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
    return !!t && t.height >= 0 && t.surface === "slick";
  };
  return (
    wet(x, z) &&
    [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ].some(([dx, dz]) => wet(x + dx, z + dz))
  );
}
export function waterWeights(
  size: number,
  x: number,
  z: number,
  level: (i: number) => number | null,
) {
  const fx = Math.floor(x),
    fz = Math.floor(z),
    tx = smooth(x - fx),
    tz = smooth(z - fz);
  const weights = new Map<number, number>();
  for (const [dx, dz, w] of [
    [0, 0, (1 - tx) * (1 - tz)],
    [1, 0, tx * (1 - tz)],
    [0, 1, (1 - tx) * tz],
    [1, 1, tx * tz],
  ]) {
    const xx = fx + dx,
      zz = fz + dz;
    if (xx < 0 || zz < 0 || xx >= size || zz >= size) continue;
    const h = level(zz * size + xx);
    if (h !== null) weights.set(h, (weights.get(h) ?? 0) + w);
  }
  return weights;
}
export function waterLevelAt(
  size: number,
  x: number,
  z: number,
  level: (i: number) => number | null,
) {
  for (const [h, w] of waterWeights(size, x, z, level)) if (w > 0.8) return h;
  return null;
}
/** A shallow bed and a continuous bank meet the horizontal surface at its shore. */
export function carveWaterBed(
  world: Ground,
  x: number,
  z: number,
  ground: number,
  unit: number,
) {
  const weights = waterWeights(world.size, x, z, (i) =>
    isWaterTile(world, i % world.size, Math.floor(i / world.size))
      ? world.terrain!.tiles[i].height
      : null,
  );
  for (const [h, w] of weights) {
    if (w <= 0.5) continue;
    const bankBlend = smooth((w - 0.5) / 0.22);
    const bed = h * unit - 0.32 * smooth((w - 0.72) / 0.28);
    return ground + (bed - ground) * bankBlend;
  }
  return ground;
}
