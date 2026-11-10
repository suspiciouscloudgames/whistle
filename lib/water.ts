import { isHole } from "./tile.ts";
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
    return !!t && !isHole(t) && t.height >= -1 && t.height <= 0 && t.surface === "slick";
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
      const h = level(zz * size + xx);
      if (h !== null) {
        weights.set(h, Math.min(1, (weights.get(h) ?? 0) + q * q * q));


        if (hole) for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const hx = xx + dx, hz = zz + dz;
          if (hx < 0 || hz < 0 || hx >= size || hz >= size || !hole(hz * size + hx)) continue;
          const along = (x - xx) * dx + (z - zz) * dz;
          const across = (x - xx) * dz - (z - zz) * dx;
          const channel = smooth(1 - ((along - .4) / .7) ** 2 - (across / .3) ** 2);
          weights.set(h, Math.max(weights.get(h) ?? 0, channel));
        }
      }
    }
  return weights;
}
export function waterLevelAt(
  size: number,
  x: number,
  z: number,
  level: (i: number) => number | null,
  hole?: (i: number) => boolean,
) {
  for (const [h, w] of waterWeights(size, x, z, level, hole)) if (w > 0.8) return h;
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
      ? world.terrain!.tiles[i].height
      : null,
    (i) => isHole(world.terrain?.tiles[i]),
  );
  for (const [h, w] of weights) {
    if (w <= 0.25) continue;


    const bankBlend = smooth((w - 0.25) / 0.35);

    const bed = h * unit - 0.32 * smooth((w - 0.72) / 0.28)
      - 0.48 * smooth((w - 0.84) / 0.16);
    return ground + (bed - ground) * bankBlend;
  }
  return ground;
}
