import type { Weather } from "./world.ts";
export const WEATHER = {
  clear: { sky: "#ffffff", sun: 1, ambient: 1, fog: 1 },
  cloud: { sky: "#d8dde1", sun: .35, ambient: .88, fog: 1.05 },
  rain: { sky: "#b9c2ca", sun: .18, ambient: .72, fog: 1.2 },
  snow: { sky: "#e6e9ec", sun: .45, ambient: .92, fog: 1.15 },
} satisfies Record<Weather, { sky: string; sun: number; ambient: number; fog: number }>;
