import { randomSequence } from "./terrain.ts";

const COLORS = ["#888b87", "#b3aea0", "#666b70", "#8b7d6c", "#a09c94", "#555c57"];

export function stoneAppearance(seed: number, x: number, z: number) {
  const random = randomSequence(seed ^ Math.imul(Math.floor(x * 997), 73856093) ^ Math.imul(Math.floor(z * 997), 19349663));
  const sizeRoll = random();
  const size = sizeRoll < 0.65
    ? 0.055 + random() * 0.13
    : sizeRoll < 0.93
      ? 0.2 + random() * 0.17
      : 0.4 + random() * 0.22;
  return {
    size,
    color: COLORS[Math.floor(random() * COLORS.length)],
    height: 0.55 + random() * 0.7,
    depth: 0.65 + random() * 0.65,
    angle: random() * Math.PI * 2,
    texture: Math.floor(random() * 3),
    grain: 0.7 + random() * 1.8,
    offset: random() * 100,
  };
}
