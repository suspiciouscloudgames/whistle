export const METEOR_DURATION = 12_000;
export const METEOR_COOLDOWN = 7 * 60_000;
export type MeteorTimeline = { seed: number; sequence: number; startsAt: number | null; cooldownUntil: number };
export type MeteorClock = { timeline: MeteorTimeline; server: number; local: number };

export function meteorRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}
export function createMeteorTimeline(seed = Math.floor(Math.random() * 0xffffffff)): MeteorTimeline {
  return { seed, sequence: 0, startsAt: null, cooldownUntil: 0 };
}
export function meteorSeed(timeline: MeteorTimeline) {
  return (timeline.seed ^ Math.imul(timeline.sequence, 0x9e3779b9)) >>> 0;
}
export function advanceMeteors(timeline: MeteorTimeline, eligible: boolean, now: number) {
  let changed = false;
  if (timeline.startsAt !== null) {
    const end = timeline.startsAt + METEOR_DURATION;
    if (eligible && now < end) return false;
    if (now >= timeline.startsAt)
      timeline.cooldownUntil = Math.max(timeline.cooldownUntil, Math.min(now, end) + METEOR_COOLDOWN);
    timeline.startsAt = null;
    changed = true;
  }
  if (eligible) {
    timeline.sequence++;
    const wait = 60_000 + meteorRandom(meteorSeed(timeline))() * 120_000;
    timeline.startsAt = Math.max(now, timeline.cooldownUntil) + wait;
    changed = true;
  }
  return changed;
}
export function meteorElapsed(timeline: MeteorTimeline, now: number) {
  if (timeline.startsAt === null) return null;
  const elapsed = now - timeline.startsAt;
  return elapsed >= 0 && elapsed < METEOR_DURATION ? elapsed / 1000 : null;
}
