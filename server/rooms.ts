import type { EventEmitter } from "node:events";
import { WebSocketServer, WebSocket } from "ws";
import { RoomDocument } from "../lib/multiplayer/room.ts";
import { ROOM_COLORS, ROOM_PATH, type ClientMessage, type Peer, type ServerMessage } from "../lib/multiplayer/protocol.ts";
import { upgradeTerrain } from "../lib/terrain.ts";
import { validateWorld } from "../lib/world.ts";

type Client = { socket: WebSocket; peer: Peer; room: Room; lastFrame: number };
type Room = { document: RoomDocument; clients: Map<string, Client>; touched: number };

export function attachRooms(server: EventEmitter) {
  const rooms = new Map<string, Room>();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 6_100_000 });
  const heartbeats = new WeakMap<WebSocket, boolean>();
  const send = (socket: WebSocket, message: ServerMessage) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount > 8_000_000) { socket.close(1013, "Slow connection"); return; }
    socket.send(JSON.stringify(message));
  };
  const publishPeer = (client: Client) => {
    for (const other of client.room.clients.values()) send(other.socket, { type: "peer", peer: client.peer });
  };
  // Leave Vite's own HMR upgrades untouched.
  const onUpgrade = (request: import("node:http").IncomingMessage, socket: import("node:stream").Duplex, head: Buffer) => {
    if (new URL(request.url ?? "/", "http://localhost").pathname !== ROOM_PATH) return;
    const origin = request.headers.origin;
    try {
      if (origin && new URL(origin).host !== request.headers.host) { socket.destroy(); return; }
    } catch { socket.destroy(); return; }
    wss.handleUpgrade(request, socket, head, ws => wss.emit("connection", ws, request));
  };
  server.on("upgrade", onUpgrade);
  wss.on("connection", socket => {
    heartbeats.set(socket, true);
    socket.on("pong", () => heartbeats.set(socket, true));
    let client: Client | undefined;
    let windowStart = Date.now(), count = 0;
    const joinTimer = setTimeout(() => { if (!client) socket.close(1008, "Join required"); }, 8000);
    socket.on("error", () => {});
    socket.on("message", raw => {
      try {
        const now = Date.now();
        if (now - windowStart > 1000) { count = 0; windowStart = now; }
        if (++count > 120) throw Error("입력이 너무 빨라요. 잠시 후 다시 시도해 주세요.");
        const message = JSON.parse(raw.toString()) as ClientMessage;
        if (!message || typeof message !== "object") throw Error("잘못된 메시지입니다.");
        if (!client) {
          if (message.type !== "join" || !/^[a-zA-Z0-9-]{12,80}$/.test(message.room)) throw Error("올바른 방 링크가 필요해요.");
          let room = rooms.get(message.room);
          if (!room) {
            if (!message.world) throw Error("방이 없거나 종료됐어요. 새 방을 만들어 주세요.");
            if (rooms.size >= 100) throw Error("지금은 새 방을 만들 수 없어요.");
            const world = upgradeTerrain(validateWorld(message.world));
            room = { document: new RoomDocument(world), clients: new Map(), touched: now };
            rooms.set(message.room, room);
          }
          if (room.clients.size >= ROOM_COLORS.length) throw Error("이 방은 최대 8명까지 함께할 수 있어요.");
          const index = ROOM_COLORS.findIndex(color => ![...room!.clients.values()].some(c => c.peer.color === color));
          const peer: Peer = { id: crypto.randomUUID(), number: index + 1, color: ROOM_COLORS[index], mode: "edit", active: true, cursor: null, frame: null };
          client = { socket, peer, room, lastFrame: now };
          room.clients.set(peer.id, client);
          room.touched = now;
          clearTimeout(joinTimer);
          send(socket, { type: "welcome", self: peer.id, world: room.document.world, revision: room.document.revision, peers: [...room.clients.values()].map(c => c.peer) });
          publishPeer(client);
          return;
        }
        const { room, peer } = client;
        room.touched = now;
        if (message.type === "presence") {
          if (!["edit", "play"].includes(message.mode) || typeof message.active !== "boolean" ||
              (message.cursor !== null && (!Number.isInteger(message.cursor) || message.cursor < 0 || message.cursor >= room.document.world.size ** 2))) throw Error("잘못된 접속 상태입니다.");
          peer.mode = message.mode; peer.active = message.active; peer.cursor = message.mode === "edit" && message.active ? message.cursor : null;
          if (peer.mode !== "play" || !peer.active) peer.frame = null;
          publishPeer(client);
        } else if (message.type === "frame") {
          if (peer.mode !== "play" || !peer.active || message.revision !== room.document.revision) return;
          const f = message.frame, size = room.document.world.size;
          if (!f || ![f.x, f.y, f.z, f.yaw, f.grass, f.rough, f.water].every(Number.isFinite) ||
              f.x < -0.5 || f.z < -0.5 || f.x > size - 0.5 || f.z > size - 0.5 || Math.abs(f.y) > 100 ||
              [f.grass, f.rough, f.water].some(n => n < 0 || n > 1) || Math.abs(f.yaw) > 1e6) return;
          peer.frame = { x: f.x, y: f.y, z: f.z, yaw: f.yaw, size, grass: f.grass, rough: f.rough, water: f.water, grounded: !!f.grounded, falling: !!f.falling };
          client.lastFrame = now;
          publishPeer(client);
        } else if (message.type === "edit" || message.type === "undo" || message.type === "redo") {
          if (peer.mode !== "edit") throw Error("만들기 화면에서 편집해 주세요.");
          if (typeof message.id !== "string" || message.id.length > 100) throw Error("잘못된 작업입니다.");
          if (message.type === "edit" && (typeof message.group !== "string" || message.group.length > 100)) throw Error("잘못된 작업입니다.");
          const result = message.type === "edit"
            ? room.document.edit(peer.id, message.id, message.group, message.edits, message.paint)
            : room.document.revert(peer.id, message.id, message.type === "redo");
          for (const other of room.clients.values()) {
            const history = room.document.history(other.peer.id);
            send(other.socket, { type: "world", id: message.id, author: peer.id, revision: room.document.revision, ...result,
              sound: message.type === "edit" && !!message.paint, canUndo: history.undo.length > 0, canRedo: history.redo.length > 0 });
          }
        }
      } catch (error) {
        send(socket, { type: "error", message: error instanceof Error ? error.message : "연결을 처리하지 못했어요." });
        if (!client) socket.close(1008, "Join failed");
      }
    });
    socket.on("close", () => {
      clearTimeout(joinTimer);
      if (!client) return;
      const { room, peer } = client;
      room.clients.delete(peer.id); room.document.forget(peer.id); room.touched = Date.now();
      for (const other of room.clients.values()) send(other.socket, { type: "left", id: peer.id });
    });
  });
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [id, room] of rooms) {
      if (!room.clients.size && now - room.touched > 30 * 60_000) { rooms.delete(id); continue; }
      for (const client of room.clients.values()) if (client.peer.frame && now - client.lastFrame > 3000) {
        client.peer.frame = null; publishPeer(client);
      }
    }
  }, 1000);
  sweep.unref();
  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (!heartbeats.get(socket)) { socket.terminate(); continue; }
      heartbeats.set(socket, false); socket.ping();
    }
  }, 15_000);
  heartbeat.unref();
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(sweep);
    clearInterval(heartbeat);
    server.off("upgrade", onUpgrade);
    for (const socket of wss.clients) socket.terminate();
    wss.close();
  };
  server.once("close", close);
  return close;
}
