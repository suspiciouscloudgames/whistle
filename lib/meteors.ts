export function meteorRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

export const MAX_METEORS_PER_SHOWER = 3;

export function createMeteorShower(startedAt: number, heading: number, pitch: number, random = Math.random) {
  const count = 1 + Math.floor(random() * MAX_METEORS_PER_SHOWER);
  const elevation = Math.tan(Math.max(.075, Math.min(1.1, pitch + .18)));
  let start = 0;
  const streaks = Array.from({ length: count }, (_, i) => {
    if (i > 0) start += 1 + random();
    return {
      start,
      duration: 1.15 + random() * .35,
      azimuth: heading - .27 + random() * .46,
      elevation: elevation + .085 + random() * .09,
      descent: .38 + random() * .4,
      travel: 12 + random() * 5,
      tailLength: 12 + random() * 4,
      width: .38 + random() * .18,
    };
  });
  const endsAt = startedAt + 1000 * Math.max(...streaks.map(streak => streak.start + streak.duration));
  return { startedAt, endsAt, streaks };
}
export type MeteorShower = ReturnType<typeof createMeteorShower>;
