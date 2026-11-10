/** Remove only the connected, similar-color region touched by the user. */
export function eraseBackground(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  tolerance: number,
) {
  const result = new Uint8ClampedArray(data);
  x = Math.floor(x);
  y = Math.floor(y);
  if (x < 0 || y < 0 || x >= width || y >= height) return result;
  const seed = (y * width + x) * 4;
  if (!data[seed + 3]) return result;
  const threshold = Math.max(0, Math.min(100, tolerance)) * 2.55;
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0,
    tail = 1;
  queue[0] = y * width + x;
  visited[queue[0]] = 1;
  while (head < tail) {
    const pixel = queue[head++],
      offset = pixel * 4;
    if (
      !data[offset + 3] ||
      Math.max(
        ...[0, 1, 2].map((c) => Math.abs(data[offset + c] - data[seed + c])),
      ) > threshold
    )
      continue;
    result[offset + 3] = 0;
    const px = pixel % width,
      py = Math.floor(pixel / width);
    for (const next of [
      px > 0 ? pixel - 1 : -1,
      px < width - 1 ? pixel + 1 : -1,
      py > 0 ? pixel - width : -1,
      py < height - 1 ? pixel + width : -1,
    ]) {
      if (next >= 0 && !visited[next]) {
        visited[next] = 1;
        queue[tail++] = next;
      }
    }
  }
  return result;
}

export function cropBounds(
  a: { x: number; y: number },
  b: { x: number; y: number },
  size: number,
) {
  const clamp = (n: number) => Math.max(0, Math.min(size, Math.round(n)));
  const x = clamp(Math.min(a.x, b.x)),
    y = clamp(Math.min(a.y, b.y));
  return {
    x,
    y,
    width: clamp(Math.max(a.x, b.x)) - x,
    height: clamp(Math.max(a.y, b.y)) - y,
  };
}
