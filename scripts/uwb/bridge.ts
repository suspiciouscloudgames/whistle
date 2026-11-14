import { createSocket } from "node:dgram";
import { WebSocketServer, WebSocket } from "ws";
import { MAX_PACKET_BYTES, TRACKING_TIMEOUT_MS, parseRanges, type BridgeMessage, type PositionMessage, type RangePacket } from "../../lib/uwb/protocol.ts";
import { solvePosition, type BridgeConfig } from "../../lib/uwb/solver.ts";

export function createProcessor(config: BridgeConfig, publish: (message: BridgeMessage) => void) {
  const states = new Map<string, { inputSeq: number; lastInput: number; point: PositionMessage | null }>();
  let seq = 0;
  return (packet: RangePacket, orderedSerial = false, now = Date.now()) => {
    if (!config.tags.includes(packet.tagId)) return;
    const previous = states.get(packet.tagId);
    const fresh = previous && now - previous.lastInput < TRACKING_TIMEOUT_MS;
    if (fresh && (orderedSerial ? packet.seq === previous.inputSeq : packet.seq <= previous.inputSeq)) {
      previous.lastInput = now;
      return;
    }
    const state = { inputSeq: packet.seq, lastInput: now,
      point: previous?.point && now - previous.point.receivedAt < TRACKING_TIMEOUT_MS ? previous.point : null };
    states.set(packet.tagId, state);
    try {
      const point = solvePosition(packet.ranges, config);
      const alpha = state.point && config.smoothingMs ? 1 - Math.exp(-(now - state.point.receivedAt) / config.smoothingMs) : 1;
      const message: PositionMessage = { type: "position", tagId: packet.tagId, seq: ++seq, receivedAt: now,
        ...point, heightSource: config.mode === "2d" ? "fixed" : "uwb" };
      if (state.point) for (const axis of ["x", "z", "boardHeight"] as const) message[axis] = state.point[axis] + alpha * (point[axis] - state.point[axis]);
      state.point = message;
      publish(message);
    } catch (error) {
      state.point = null;
      publish({ type: "invalid", tagId: packet.tagId, seq: ++seq, error: (error as Error).message });
    }
  };
}

export async function startBridge(config: BridgeConfig, options: {
  wsPort?: number; udpPort?: number; udpHost?: string; log?: (message: string) => void;
} = {}) {
  const log = options.log ?? console.log;
  const server = new WebSocketServer({ host: "127.0.0.1", port: options.wsPort ?? 5194, maxPayload: MAX_PACKET_BYTES,
    verifyClient: ({ origin }: { origin: string }) => {
      if (!origin) return true;
      try { return ["127.0.0.1", "localhost", "[::1]"].includes(new URL(origin).hostname); }
      catch { return false; }
    },
  });
  const udp = createSocket("udp4");
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    for (const client of server.clients) client.terminate();
    await Promise.all([new Promise<void>((resolve) => server.close(() => resolve())),
      new Promise<void>((resolve) => { try { udp.close(() => resolve()); } catch { resolve(); } })]);
  };
  try {
    await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
    await new Promise<void>((resolve, reject) => {
      udp.once("error", reject);
      udp.bind(options.udpPort ?? 5195, options.udpHost ?? "127.0.0.1", resolve);
    });
  } catch (error) { await close(); throw error; }
  server.on("connection", (client) => { client.on("error", () => client.terminate()); });
  server.on("error", (error) => log(`WebSocket 오류: ${error.message}`));
  udp.on("error", (error) => log(`UDP 오류: ${error.message}`));
  const receive = createProcessor(config, (message) => {
    const json = JSON.stringify(message);
    for (const client of server.clients) {
      if (client.bufferedAmount > MAX_PACKET_BYTES * 4) { client.terminate(); continue; }
      if (client.readyState === WebSocket.OPEN) client.send(json);
    }
  });
  let lastWarning = -Infinity;
  udp.on("message", (buffer) => {
    try {
      if (buffer.length > MAX_PACKET_BYTES) throw new Error("UDP 패킷이 너무 큽니다.");
      receive(parseRanges(buffer.toString()));
    } catch (error) {
      if (Date.now() - lastWarning > 1000) { log(`입력 무시: ${(error as Error).message}`); lastWarning = Date.now(); }
    }
  });
  return { wsPort: (server.address() as { port: number }).port, udpPort: udp.address().port, receive, close };
}
