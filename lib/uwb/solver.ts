import { finite, identifier, record, type Point, type Range } from "./protocol.ts";

export type Anchor = Point & { id: string };
export type BridgeConfig = {
  anchors: Anchor[]; tags: string[]; mode: "2d" | "3d";
  fixedHeight: number; maxResidual: number; smoothingMs: number;
};

export function parseConfig(value: unknown): BridgeConfig {
  if (!record(value) || (value.mode !== "2d" && value.mode !== "3d")
    || !finite(value.fixedHeight) || value.fixedHeight < 0 || value.fixedHeight > 10
    || !finite(value.maxResidual) || value.maxResidual <= 0 || value.maxResidual > 2
    || !finite(value.smoothingMs) || value.smoothingMs < 0 || value.smoothingMs > 1000
    || !Array.isArray(value.tags) || !value.tags.length || value.tags.length > 4
    || !value.tags.every(identifier) || new Set(value.tags).size !== value.tags.length
    || !Array.isArray(value.anchors) || value.anchors.length < (value.mode === "2d" ? 3 : 4)
    || value.anchors.length > 8) throw new Error("UWB 설정 형식 오류");
  const ids = new Set<string>();
  for (const a of value.anchors) {
    if (!record(a) || !identifier(a.id) || ids.has(a.id)
      || !finite(a.x) || !finite(a.z) || !finite(a.boardHeight)
      || Math.abs(a.x) > 1000 || Math.abs(a.z) > 1000 || a.boardHeight < 0 || a.boardHeight > 10) throw new Error("앵커 설정 오류");
    ids.add(a.id);
  }
  const config = value as BridgeConfig;
  const vectors = config.anchors.map((a) => coordinates(a, config.mode));
  leastSquares(vectors.slice(1).map((p) => p.map((v, i) => v - vectors[0][i])), vectors.slice(1).map(() => 0));
  return config;
}

const coordinates = (p: Point, mode: BridgeConfig["mode"]) => mode === "2d" ? [p.x, p.z] : [p.x, p.z, p.boardHeight];
export const distanceTo = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z, a.boardHeight - b.boardHeight);

function leastSquares(rows: number[][], values: number[]): number[] {
  const n = rows[0]?.length ?? 0;
  if (!n || rows.length < n) throw new Error("유효한 앵커가 부족합니다.");
  const q: number[][] = [];
  const r = Array.from({ length: n }, () => Array<number>(n).fill(0));
  const scale = Math.max(...rows.flat().map(Math.abs));
  for (let j = 0; j < n; j++) {
    const column = rows.map((row) => row[j]);
    for (let i = 0; i < j; i++) {
      r[i][j] = column.reduce((sum, v, k) => sum + v * q[i][k], 0);
      column.forEach((_, k) => { column[k] -= r[i][j] * q[i][k]; });
    }
    r[j][j] = Math.hypot(...column);
    if (!Number.isFinite(r[j][j]) || r[j][j] <= Math.max(1e-8, scale * 1e-4)) throw new Error("앵커 배치로 위치를 구분할 수 없습니다.");
    q.push(column.map((v) => v / r[j][j]));
  }
  const result = q.map((column) => column.reduce((sum, v, k) => sum + v * values[k], 0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = i + 1; j < n; j++) result[i] -= r[i][j] * result[j];
    result[i] /= r[i][i];
  }
  return result;
}

export function solvePosition(ranges: Range[], config: BridgeConfig): Point & { residual: number; anchors: number } {
  const seen = new Set<string>();
  const readings = ranges.flatMap((range) => {
    if (!finite(range.distance) || range.distance <= 0 || range.distance > 500 || seen.has(range.anchorId)) throw new Error("거리값 오류");
    seen.add(range.anchorId);
    const anchor = config.anchors.find((a) => a.id === range.anchorId);
    return anchor ? [{ anchor, distance: range.distance }] : [];
  });
  const dimension = config.mode === "2d" ? 2 : 3;
  if (readings.length < dimension + 1) throw new Error(`유효한 앵커가 ${dimension + 1}개 이상 필요합니다.`);
  const points = readings.map(({ anchor }) => coordinates(anchor, config.mode));
  const radii = readings.map(({ anchor, distance }) => {
    const squared = distance ** 2 - (config.mode === "2d" ? (config.fixedHeight - anchor.boardHeight) ** 2 : 0);
    if (squared < -(config.maxResidual ** 2)) throw new Error("거리값이 앵커와 보드의 높이 차이보다 작습니다.");
    return squared;
  });
  const norm = (p: number[]) => p.reduce((sum, x) => sum + x * x, 0);
  let position = leastSquares(points.slice(1).map((p) => p.map((v, i) => 2 * (v - points[0][i]))),
    points.slice(1).map((p, i) => radii[0] - radii[i + 1] + norm(p) - norm(points[0])));
  for (let step = 0; step < 8; step++) {
    const point = { x: position[0], z: position[1], boardHeight: dimension === 3 ? position[2] : config.fixedHeight };
    const distances = readings.map(({ anchor }) => Math.max(1e-8, distanceTo(point, anchor)));
    const jacobian = points.map((p, i) => p.map((v, k) => (position[k] - v) / distances[i]));
    const delta = leastSquares(jacobian, readings.map((r, i) => r.distance - distances[i]));
    position = position.map((v, i) => v + delta[i]);
    if (Math.hypot(...delta) < 1e-6) break;
  }
  const point = { x: position[0], z: position[1], boardHeight: dimension === 3 ? position[2] : config.fixedHeight };
  const residual = Math.sqrt(readings.reduce((sum, r) => sum + (distanceTo(point, r.anchor) - r.distance) ** 2, 0) / readings.length);
  if (!Object.values(point).every(Number.isFinite) || point.boardHeight < 0 || point.boardHeight > 10
    || !Number.isFinite(residual) || residual > config.maxResidual) throw new Error("거리 오차가 크거나 보드 높이가 범위를 벗어났습니다.");
  return { ...point, residual, anchors: readings.length };
}
