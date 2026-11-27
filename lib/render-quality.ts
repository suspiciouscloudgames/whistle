export function renderQuality(
  search = typeof location === "undefined" ? "" : location.search,
  deviceRatio = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1,
) {
  const high = new URLSearchParams(search).get("quality") === "high";
  return {
    name: high ? "high" : "low",
    pixelRatio: Math.min(deviceRatio, high ? 2 : 1),
    samples: high ? 4 : 0,
    shadowSize: high ? 1024 : 512,
    shadowInterval: high ? 0 : 125,
  } as const;
}

export function createAdaptiveResolution(maximum: number, lowerBelowFps = 28) {
  const minimum = Math.min(maximum, .5), step = maximum / 4;
  let ratio = maximum, elapsed = 0, frames = 0, slow = 0, fast = 0;
  const reset = () => { elapsed = frames = slow = fast = 0; };
  return {
    reset,
    sample(milliseconds: number) {
      if (!Number.isFinite(milliseconds) || milliseconds <= 0 || milliseconds > 1000) {
        reset();
        return ratio;
      }
      elapsed += milliseconds;
      frames++;
      if (elapsed < 2000) return ratio;
      const fps = frames * 1000 / elapsed;
      elapsed = frames = 0;
      slow = fps < lowerBelowFps ? slow + 1 : 0;
      fast = fps > Math.max(50, lowerBelowFps + 10) ? fast + 1 : 0;
      if (slow >= 2) { ratio = Math.max(minimum, ratio - step); slow = fast = 0; }
      else if (fast >= 10) { ratio = Math.min(maximum, ratio + step); slow = fast = 0; }
      return ratio;
    },
  };
}
