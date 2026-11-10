import { randomSequence } from "./terrain.ts";
import type { Weather } from "./world.ts";
export const WEATHER = {
  clear: { sky: "#ffffff", sun: 1, ambient: 1, fog: 1 },
  cloud: { sky: "#d8dde1", sun: .35, ambient: .88, fog: 1.05 },
  rain: { sky: "#b9c2ca", sun: .18, ambient: .72, fog: 1.2 },
  snow: { sky: "#e6e9ec", sun: .45, ambient: .92, fog: 1.15 },
} satisfies Record<Weather, { sky: string; sun: number; ambient: number; fog: number }>;


export function cloudLayout(size: number) {
  const random = randomSequence(4027);
  const span = size * 3.6;
  return Array.from({ length: 16 }, (_, i) => ({
    x: ((i % 4) + .15 + random() * .7) * span / 4 - span / 2,
    z: (Math.floor(i / 4) + .15 + random() * .7) * span / 4 - span / 2,
    y: 10 + random() * 18,
    width: 10 + random() * 13,
    height: 3.5 + random() * 3.5,
    phase: random() * Math.PI * 2,
  }));
}
