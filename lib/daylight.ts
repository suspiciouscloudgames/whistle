const smooth = (low: number, high: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - low) / (high - low)));
  return t * t * (3 - 2 * t);
};

/** Local device time; a daily artistic cycle, without location or a weather service. */
export function daylightAt(date: Date) {
  const hour =
    date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
  const angle = ((hour - 6) / 24) * Math.PI * 2;
  const elevation = Math.sin(angle);
  const daylight = smooth(-0.22, 0.35, elevation);
  return {
    hour,
    daylight,
    ambient: 0.28 + daylight * 1.12,
    sun: 1.7 * smooth(-0.04, 0.28, elevation),
    moon: 0.22 * (1 - daylight),
    sunX: -Math.cos(angle) * 24,
    sunY: Math.max(0.7, elevation * 25),
    sunZ: 8,
    fog: 1 + (1 - daylight) * 0.22,
  };
}
