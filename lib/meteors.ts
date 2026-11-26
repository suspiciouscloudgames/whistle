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
  const streaks = Array.from({ length: count }, (_, i) => ({
    start: i * (.45 + random() * .15),
    duration: 1.6 + random() * .5,
    azimuth: heading + (i === 0 ? -.09 : (i === 1 ? .22 : -.27)) + (random() - .5) * .12,
    elevation: elevation + random() * .035,
    travel: 6 + random() * 5,
    width: .38 + random() * .18,
  }));
  const endsAt = startedAt + 1000 * Math.max(...streaks.map(streak => streak.start + streak.duration));
  return { startedAt, endsAt, streaks };
}
export type MeteorShower = ReturnType<typeof createMeteorShower>;
