import type { Readable } from "node:stream";
import { MAX_PACKET_BYTES, parseRanges, type RangePacket } from "../../lib/uwb/protocol.ts";

export function parseMakerfabs(line: string): RangePacket | null {
  if (!line.startsWith("AT+RANGE=")) return null;
  if (line.length > MAX_PACKET_BYTES) throw new Error("거리 패킷이 너무 큽니다.");
  const match = /^AT\+RANGE=tid:(\d+),mask:([\da-f]+),seq:(\d+),range:\(([^)]+)\)(.*)$/i.exec(line.trim());
  if (!match) throw new Error("Makerfabs RANGE 형식 오류");
  const [, tagId, maskText, seq, rangeText, tail] = match;
  const mask = Number.parseInt(maskText, 16);
  const distances = rangeText.split(",").map(Number);
  const anchorMatch = /(?:^|,)ancid:\(([^)]+)\)/.exec(tail);
  if (tail.includes("ancid:") && !anchorMatch) throw new Error("Makerfabs ancid 형식 오류");
  const ids = anchorMatch ? anchorMatch[1].split(",").map(Number) : distances.map((_, i) => i);
  if (distances.length !== 8 || ids.length !== 8 || mask > 255
    || !distances.every((d) => Number.isInteger(d) && d >= 0)
    || !ids.every(Number.isInteger)) throw new Error("Makerfabs 거리/앵커 목록 오류");
  return parseRanges(JSON.stringify({ type: "ranges", tagId, seq: Number(seq),
    ranges: distances.flatMap((distance, i) => mask & (1 << i) ? [{ anchorId: String(ids[i]), distance: distance / 100 }] : []),
  }));
}

export function attachLines(stream: Readable, receive: (line: string) => void, error: (message: string) => void) {
  let buffer = "";
  let dropping = false;
  const data = (chunk: Buffer | string) => {
    for (const char of chunk.toString()) {
      if (char === "\n") {
        if (!dropping && buffer.trim()) receive(buffer.trim());
        buffer = "";
        dropping = false;
      } else if (!dropping) {
        buffer += char;
        if (buffer.length > MAX_PACKET_BYTES) {
          buffer = "";
          dropping = true;
          error("너무 긴 직렬 입력을 건너뜁니다.");
        }
      }
    }
  };
  stream.on("data", data);
  return () => stream.off("data", data);
}
