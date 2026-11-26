import type { Asset } from "./world.ts";

export function contentOpacity(display: Asset["display"], distance: number, seconds: number, phase: number, reducedMotion = false) {
  if (display === "nearby") {
    const t = Math.max(0, Math.min(1, (9 - distance) / 5));
    return t * t * (3 - 2 * t);
  }
  if (display === "pulse" && !reducedMotion) {
    const t = Math.max(0, Math.min(1, (.5 + .5 * Math.sin(seconds * Math.PI / 5 + phase) - .15) / .7));
    return t * t * (3 - 2 * t);
  }
  return 1;
}

export const floatingHeight = 2.9;

export function floatingPose(seconds: number, phase: number, reducedMotion = false) {
  if (reducedMotion) return { x: 0, y: floatingHeight, roll: 0 };
  return {
    x: Math.sin(seconds * .43 + phase) * .16,
    y: floatingHeight + Math.sin(seconds * .78 + phase) * .28 + Math.sin(seconds * .31 + phase * .7) * .07,
    roll: Math.sin(seconds * .51 + phase) * .025,
  };
}
