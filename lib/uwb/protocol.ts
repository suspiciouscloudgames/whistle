export type Point = { x: number; z: number; boardHeight: number };
export type Range = { anchorId: string; distance: number };
export type RangePacket = { type: "ranges"; tagId: string; seq: number; ranges: Range[] };
export type PositionMessage = Point & {
  type: "position"; tagId: string; seq: number; receivedAt: number;
  heightSource: "fixed" | "uwb"; residual: number; anchors: number;
};
export type InvalidMessage = { type: "invalid"; tagId: string; seq: number; error: string };
export type BridgeMessage = PositionMessage | InvalidMessage;
export const TRACKING_TIMEOUT_MS = 1000;
export const MAX_PACKET_BYTES = 4096;

export function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
export function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
export function identifier(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,32}$/.test(value);
}
export function sequence(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

export function parseRanges(text: string): RangePacket {
  if (text.length > MAX_PACKET_BYTES) throw new Error("거리 패킷이 너무 큽니다.");
  const value: unknown = JSON.parse(text);
  if (!record(value) || value.type !== "ranges" || !identifier(value.tagId) || !sequence(value.seq)
    || !Array.isArray(value.ranges) || value.ranges.length > 8) throw new Error("거리 패킷 형식 오류");
  const ids = new Set<string>();
  for (const range of value.ranges) {
    if (!record(range) || !identifier(range.anchorId) || !finite(range.distance)
      || range.distance <= 0 || range.distance > 500 || ids.has(range.anchorId)) throw new Error("거리값 또는 앵커 ID 오류");
    ids.add(range.anchorId);
  }
  return value as RangePacket;
}

export function parseBridgeMessage(text: string): BridgeMessage {
  if (text.length > MAX_PACKET_BYTES) throw new Error("좌표 패킷이 너무 큽니다.");
  const v: unknown = JSON.parse(text);
  if (!record(v) || !identifier(v.tagId) || !sequence(v.seq)) throw new Error("좌표 패킷 형식 오류");
  if (v.type === "invalid" && typeof v.error === "string" && v.error.length <= 200) return v as InvalidMessage;
  if (v.type !== "position" || !finite(v.x) || !finite(v.z) || !finite(v.boardHeight)
    || v.boardHeight < 0 || v.boardHeight > 10 || !finite(v.receivedAt)
    || !finite(v.residual) || v.residual < 0 || !Number.isInteger(v.anchors)
    || (v.anchors as number) < 3 || (v.anchors as number) > 8
    || (v.heightSource !== "fixed" && v.heightSource !== "uwb")) throw new Error("좌표 패킷 형식 오류");
  return v as PositionMessage;
}
