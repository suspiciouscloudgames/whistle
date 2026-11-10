/** Physical keys keep movement available with Korean input and Caps Lock. */
export function movementKey(event: {
  code: string;
  key: string;
}): string | null {
  const codes: Record<string, string> = {
    KeyW: "w",
    KeyA: "a",
    KeyS: "s",
    KeyD: "d",
    ArrowUp: "arrowup",
    ArrowDown: "arrowdown",
    ArrowLeft: "arrowleft",
    ArrowRight: "arrowright",
  };
  if (Object.hasOwn(codes, event.code)) return codes[event.code];
  if (event.code && event.code !== "Unidentified") return null;
  const key = event.key.toLowerCase();
  return Object.values(codes).includes(key) ? key : null;
}

/** Frame-rate independent camera turn, taking the shortest route across north. */
export function followHeading(current: number, target: number, dt: number) {
  const difference = Math.atan2(
    Math.sin(target - current),
    Math.cos(target - current),
  );
  const elapsed = Math.max(0, dt);
  const eased = difference * (1 - Math.exp(-4 * elapsed));
  const limit = 0.6 * elapsed;
  return current + Math.max(-limit, Math.min(limit, eased));
}

export const FALL_SECONDS = 2.2;
/** A short accelerating descent, then a covered reset rather than a camera jump. */
export function fallFrame(originY: number, elapsed: number) {
  const t = Math.max(0, Math.min(FALL_SECONDS, elapsed));
  const fade = Math.max(0, Math.min(1, (t - 1.75) / 0.35));
  return {
    y: originY - 0.6 * t - 2.2 * t * t,
    fade,
    done: elapsed >= FALL_SECONDS,
  };
}

/** Missing ground is walkable until the descent starts; cliffs still block walking. */
export function blocksGroundStep(
  current: number | null,
  next: number | null,
  distance: number,
) {
  return (
    current !== null &&
    next !== null &&
    Math.abs(next - current) > Math.max(0.23, distance * 5)
  );
}
