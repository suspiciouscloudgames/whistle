import { randomSequence } from "./terrain.ts";

export const TREE_SPECIES = ["pine", "zelkova", "ginkgo", "maple"] as const;
export type TreeSpecies = (typeof TREE_SPECIES)[number];
function hash(seed: number, x: number, z: number) {
  let h = seed ^ Math.imul(x, 73856093) ^ Math.imul(z, 19349663);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return (h ^ (h >>> 16)) >>> 0;
}
export function treeAppearance(seed: number, x: number, z: number) {
  const variantSeed = hash(seed ^ 0x71ee, x, z);
  const random = randomSequence(variantSeed);
  const species = TREE_SPECIES[Math.floor(random() * TREE_SPECIES.length)];
  return {
    seed: variantSeed,
    species,
    height: (species === "maple" ? 3.7 : 4.8) + random() * 1.7,
    width: 1.6 + random() * 0.8,
    lean: (random() - 0.5) * (species === "pine" ? 1.4 : 0.5),
    rotation: random() * Math.PI * 2,
    tint: random(),
  };
}

const GRASS_COLORS = [
  [100, 145, 38],
  [158, 167, 61],
  [43, 105, 61],
  [103, 145, 88],
  [151, 139, 68],
  [54, 126, 89],
];
/** Broad blended patches, with small root-level differences; no frame-time randomness. */
export function grassAppearance(seed: number, x: number, z: number) {
  const gx = x / 2.8,
    gz = z / 2.8,
    ix = Math.floor(gx),
    iz = Math.floor(gz);
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const tx = smooth(gx - ix),
    tz = smooth(gz - iz);
  const rgb = [0, 0, 0];
  for (const [dx, dz, weight] of [
    [0, 0, (1 - tx) * (1 - tz)],
    [1, 0, tx * (1 - tz)],
    [0, 1, (1 - tx) * tz],
    [1, 1, tx * tz],
  ]) {
    const c = GRASS_COLORS[hash(seed, ix + dx, iz + dz) % GRASS_COLORS.length];
    c.forEach((v, i) => (rgb[i] += (v / 255) * weight));
  }
  const grain = hash(seed, Math.floor(x * 23), Math.floor(z * 23)) / 0xffffffff;
  const shade = 0.78 + grain * 0.4;
  return {
    r: rgb[0] * shade,
    g: rgb[1] * shade,
    b: rgb[2] * shade,
    height: 0.65 + grain * 0.8,
  };
}
