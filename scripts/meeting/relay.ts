import { randomUUID, createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { EventEmitter } from "node:events";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import { createMeetingCodec } from "../../lib/meeting-wire.ts";
import { TURN_HINT } from "../../lib/workshop.ts";
import { MEETING_PATH, createMeetingRoom, addMeetingMember, meetingView, meetingPresence,
  publishMeeting, moveMeeting, whistleMeeting, meetingWhistleRecipients, whistleForViewer,
  disconnectMeetingMember, leaveMeetingMember, reconcileMeeting, meetingNeighbors, type MeetingRoom, type MeetingMessage } from "../../lib/meeting.ts";
import { setMeetingNightSky } from "../../lib/meeting.ts";

export function attachMeetingRelay(server: EventEmitter, options: {cleanupMs?: number; reconnectMs?: number} = {}) {
  type Entry = {room:MeetingRoom; sockets:Map<string,WebSocket>; touched:number; queue:Promise<void>; presenceDirty?:boolean};
  const rooms = new Map<string, Entry>();
  let closing: Promise<void> | undefined;
  const getRoom = (key:string) => {
    let entry = rooms.get(key);
    if (!entry) { entry = {room:createMeetingRoom(),sockets:new Map(),touched:Date.now(),queue:Promise.resolve()};rooms.set(key,entry); }
    return entry;
  };
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16*1024*1024, perMessageDeflate: false });
  const codecs = new WeakMap<WebSocket, ReturnType<typeof createMeetingCodec>>();
  const send = (socket: WebSocket, message: MeetingMessage) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount > 32*1024*1024) { socket.terminate(); return; }
    const codec = codecs.get(socket)!;
    try { for (const frame of codec.encode(message)) socket.send(frame); }
    catch { socket.close(1009, "Material cache full"); }
  };
  const broadcast = (entry: Entry, state: boolean, recipients?:Set<string>) => {
    if(!recipients)entry.presenceDirty=false;
    for (const [id, socket] of entry.sockets) {
      if(recipients&&!recipients.has(id))continue;
      const presence = meetingPresence(entry.room, id);
      send(socket, state ? { type: "state", view: meetingView(entry.room, id), presence } : { type: "presence", presence });
    }
  };
  const upgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(request.url || "/", "http://localhost");
    if (url.pathname !== MEETING_PATH) return;
    const key = url.searchParams.get("room"), requested = url.searchParams.get("id"), token = url.searchParams.get("token");
    if (!key || key.length > 100 || !token || !/^[a-zA-Z0-9-]{16,100}$/.test(token) || (!rooms.has(key) && rooms.size >= 32)) {
      socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n"); socket.destroy(); return;
    }
    const entry = getRoom(key);
    if (closing || socket.destroyed) { socket.destroy(); return; }
    wss.handleUpgrade(request, socket, head, ws => {
      codecs.set(ws, createMeetingCodec());
      const id = requested && /^[a-zA-Z0-9-]{8,80}$/.test(requested) ? requested : randomUUID();
      const resumeKey = createHash("sha256").update(token).digest("hex");
      const existing = entry.room.members.get(id);
      if (existing?.resumeKey && existing.resumeKey !== resumeKey) {
        send(ws,{type:"error",message:"이 세계의 접속 정보를 확인할 수 없습니다."});ws.close(1008);return;
      }
      try { addMeetingMember(entry.room, id).resumeKey = resumeKey; }
      catch (error) { send(ws, { type: "error", message: (error as Error).message }); ws.close(1008); return; }
      const previous = entry.sockets.get(id);
      entry.sockets.set(id, ws); entry.touched = Date.now();
      previous?.close(4001, "Session resumed elsewhere");
      entry.queue = entry.queue.then(() => { broadcast(entry,true); });
      let alive = true, frameStart = Date.now(), messages = 0;
      ws.on("pong", () => { alive = true; });
      ws.on("error", () => ws.terminate());
      const heartbeat = setInterval(() => { if (!alive) ws.terminate(); else { alive = false; ws.ping(); } }, 15_000);
      heartbeat.unref();
      ws.on("message", (data, binary) => {
        if (entry.sockets.get(id) !== ws || closing) return;
        if (binary) { ws.close(1003); return; }
        if (Date.now() - frameStart > 1000) { frameStart = Date.now(); messages = 0; }
        if (++messages > 120) return;
        entry.queue = entry.queue.then(() => {
        if (entry.sockets.get(id) !== ws) return;
        try {
          const message = codecs.get(ws)!.decode<Record<string, any>>(data.toString());
          if (!message || typeof message !== "object") return;
          entry.touched = Date.now();
          let changed = false;
          if(message.type === "leave") {
            entry.sockets.delete(id);leaveMeetingMember(entry.room,id);
            if(!entry.sockets.size && rooms.get(key)===entry)rooms.delete(key);
            broadcast(entry,true);ws.close(4002,"World restarted");return;
          }
          if(message.type === "publish")changed=publishMeeting(entry.room,id,message.world,
            Array.isArray(message.received) ? message.received.filter((v: unknown) => typeof v === "string").slice(-10000) : [],false,true);
          else if (message.type === "night-sky" && typeof message.eligible === "boolean") {
            if (setMeetingNightSky(entry.room, id, message.eligible)) broadcast(entry, false);
            return;
          }
          else if (message.type === "whistle") {
            const whistle = whistleMeeting(entry.room, id);
            if (whistle) for (const peer of meetingWhistleRecipients(entry.room,id)) {
              const target = entry.sockets.get(peer);
              const projected=whistleForViewer(entry.room,whistle,peer);
              if (target && projected && entry.room.members.get(peer)?.playing) send(target, {type:"whistle",whistle:projected});
            }
            return;
          }
          else if (message.type === "position" && message.player && typeof message.playing === "boolean" &&
            typeof message.player.grounded === "boolean" && (message.player.pitch === undefined || Number.isFinite(message.player.pitch))) {
            if(entry.sockets.get(id)!==ws)return;
            changed = moveMeeting(entry.room, id, message.player, message.playing, message.resetId ?? 0);
            if(changed)broadcast(entry,true);else entry.presenceDirty=true;
            return;
          }
          if (changed) broadcast(entry,true);
        } catch (error) {
          const message = error instanceof Error ? error.message : "연결 데이터를 저장하지 못했습니다.";
          send(ws, { type: "error", message, ...(message === TURN_HINT ? {world:entry.room.members.get(id)!.document} : {}) });
          if(message === TURN_HINT)broadcast(entry,true);
        }
        });
      });
      ws.on("close", () => {
        clearInterval(heartbeat);
        if (entry.sockets.get(id) !== ws) return;
        entry.sockets.delete(id);
        disconnectMeetingMember(entry.room,id);entry.touched=Date.now();
        if(!entry.sockets.size && rooms.get(key)===entry)rooms.delete(key);
        entry.queue=entry.queue.then(()=>{
          if(entry.sockets.has(id))return;
          broadcast(entry,true);
        }).catch(()=>{});
      });
    });
  };
  server.on("upgrade", upgrade);
  const presenceTick=setInterval(()=>{
    for(const entry of rooms.values())if(entry.presenceDirty)broadcast(entry,false);
  },80);
  presenceTick.unref();
  const cleanup = setInterval(() => {
    for(const entry of rooms.values())if(entry.sockets.size)entry.queue=entry.queue.then(()=>{
      if(reconcileMeeting(entry.room,Date.now(),options.reconnectMs))broadcast(entry,true);
    }).catch(()=>{});
  }, options.cleanupMs ?? 1_000);
  cleanup.unref();
  const close = () => {
    if (closing) return closing;
    clearInterval(cleanup);clearInterval(presenceTick); server.off("upgrade", upgrade); server.off("close", close);
    for (const ws of wss.clients) ws.terminate(); wss.close();
    closing = Promise.all([...rooms.values()].map(entry => entry.queue)).then(() => { rooms.clear(); });
    return closing;
  };
  server.once("close", close);
  return { close };
}
