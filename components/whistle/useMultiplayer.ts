import { useCallback, useEffect, useRef, useState } from "react";
import type { World } from "@/lib/world";
import { isHole, type TerrainTool } from "@/lib/tile";
import type { Surface } from "@/lib/terrain";
import type { PlayerAudioFrame } from "@/lib/audio/game-parameters";
import { applyPatches, diffWorld, ROOM_PATH, type ClientMessage, type Peer, type ServerMessage } from "@/lib/multiplayer/protocol";

export type CellFlash = { id: string; color: string; cells: number[] };
type Options = {
  getWorld: () => World;
  onWorld: (world: World, initial: boolean) => void;
  onEditSound: (before: World, after: World, cells: number[]) => void;
  onPeers: (peers: Peer[], self: string) => void;
  notify: (message: string) => void;
  playing: boolean;
  keepActive?: boolean;
};
export function useMultiplayer(options: Options) {
  const handlers = useRef(options); handlers.current = options;
  const [room, setRoom] = useState(() => new URLSearchParams(location.search).get("room") ?? "");
  const [status, setStatus] = useState<"offline" | "connecting" | "connected" | "failed">(room ? "connecting" : "offline");
  const [participants, setParticipants] = useState<Peer[]>([]);
  const [soundPlayers, setSoundPlayers] = useState(0);
  const [self, setSelf] = useState("");
  const [history, setHistory] = useState({ canUndo: false, canRedo: false });
  const [flashes, setFlashes] = useState<CellFlash[]>([]);
  const socket = useRef<WebSocket | null>(null);
  const seed = useRef<World | undefined>(undefined);
  const peers = useRef(new Map<string, Peer>());
  const selfId = useRef("");
  const sharedWorld = useRef<World | null>(null);
  const revision = useRef(0);
  const lastFrame = useRef<{ frame: PlayerAudioFrame; revision: number } | null>(null);
  const cursor = useRef<number | null>(null);
  const active = useRef(!document.hidden);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const stroke = useRef<{ id: string; cells: Set<number>; hole: boolean } | null>(null);
  const send = useCallback((message: ClientMessage) => {
    if (socket.current?.readyState !== WebSocket.OPEN || (message.type !== "join" && !selfId.current)) return false;
    socket.current.send(JSON.stringify(message)); return true;
  }, []);
  const presence = useCallback(() => send({ type: "presence", mode: handlers.current.playing ? "play" : "edit", active: active.current, cursor: cursor.current }), [send]);

  useEffect(() => {
    if (!room) return;
    setStatus("connecting");
    let live = true;
    const url = new URL(ROOM_PATH, location.href); url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(url); socket.current = ws;
    selfId.current = ""; sharedWorld.current = null; peers.current.clear();
    const timeout = setTimeout(() => {
      if (!selfId.current && live) { handlers.current.notify("방에 연결하지 못했어요. 방 서버가 실행 중인지 확인해 주세요."); ws.close(); }
    }, 8000);
    const updatePeers = (render: boolean) => {
      const all = [...peers.current.values()];
      setSoundPlayers(all.filter(peer => peer.mode === "play" && peer.active && peer.frame).length);
      handlers.current.onPeers(all, selfId.current);
      if (render) setParticipants(all.map(peer => ({ ...peer, frame: null })));
    };
    ws.onopen = () => ws.send(JSON.stringify({ type: "join", room, ...(seed.current ? { world: seed.current } : {}) }));
    ws.onmessage = event => {
      if (!live) return;
      const message = JSON.parse(event.data) as ServerMessage;
      if (message.type === "welcome") {
        clearTimeout(timeout); seed.current = undefined;
        selfId.current = message.self; setSelf(message.self);
        sharedWorld.current = message.world; revision.current = message.revision;
        for (const peer of message.peers) peers.current.set(peer.id, peer);
        setHistory({ canUndo: false, canRedo: false });
        handlers.current.onWorld(message.world, true);
        setStatus("connected"); updatePeers(true); presence();
      } else if (message.type === "peer") {
        const old = peers.current.get(message.peer.id), next = message.peer;
        peers.current.set(next.id, next);
        updatePeers(!old || old.mode !== next.mode || old.active !== next.active || old.cursor !== next.cursor);
      } else if (message.type === "left") { peers.current.delete(message.id); updatePeers(true); }
      else if (message.type === "world" && sharedWorld.current) {
        setHistory({ canUndo: message.canUndo, canRedo: message.canRedo });
        if (message.revision > revision.current && message.patches.length) {
          if (message.revision !== revision.current + 1) { ws.close(); return; }
          const before = sharedWorld.current, next = applyPatches(before, message.patches);
          sharedWorld.current = next; revision.current = message.revision;
          handlers.current.onWorld(next, false);
          if (message.author === selfId.current && message.sound && !handlers.current.playing)
            handlers.current.onEditSound(before, next, message.cells);
          const author = peers.current.get(message.author);
          if (author && message.cells.length) {
            const flash = { id: `${message.id}:${message.revision}`, color: author.color, cells: message.cells };
            setFlashes(previous => [...previous.slice(-11), flash]);
            const timer = setTimeout(() => { timers.current.delete(timer); if (live) setFlashes(previous => previous.filter(f => f.id !== flash.id)); }, 900);
            timers.current.add(timer);
          }
        }
        if (message.author === selfId.current && message.skipped) handlers.current.notify("다른 사람이 수정했거나 사용할 수 없는 일부 칸은 유지했어요.");
      } else if (message.type === "error") handlers.current.notify(message.message);
    };
    ws.onerror = () => {};
    ws.onclose = () => {
      if (!live) return;
      clearTimeout(timeout); selfId.current = ""; peers.current.clear();
      setStatus("failed"); setParticipants([]); handlers.current.onPeers([], "");
      setSoundPlayers(0);
    };
    return () => {
      live = false; clearTimeout(timeout); ws.close(); socket.current = null;
      selfId.current = ""; peers.current.clear(); stroke.current = null;
      lastFrame.current = null;
      for (const timer of timers.current) clearTimeout(timer);
      timers.current.clear(); handlers.current.onPeers([], "");
    };
  }, [room, presence]);

  useEffect(() => { cursor.current = null; stroke.current = null; lastFrame.current = null; presence(); }, [options.playing, presence]);
  useEffect(() => {
    active.current = !!options.keepActive || (!document.hidden && document.hasFocus());
    presence();
    const pause = () => { if (!options.keepActive) { active.current = false; cursor.current = null; presence(); } };
    const resume = () => { if ((options.keepActive || !document.hidden) && !active.current) { active.current = true; presence(); } };
    const visibility = () => { if (document.hidden) pause(); };
    window.addEventListener("blur", pause); document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pointerdown", resume); window.addEventListener("keydown", resume);
    return () => {
      window.removeEventListener("blur", pause); document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pointerdown", resume); window.removeEventListener("keydown", resume);
    };
  }, [options.keepActive, presence]);
  useEffect(() => {
    if (!room || !options.keepActive || !options.playing) return;
    // Hidden windows may stop requestAnimationFrame. Keep the last computed
    // source alive without pretending it was calculated for a newer world.
    const timer = setInterval(() => {
      if (active.current && lastFrame.current) send({ type: "frame", ...lastFrame.current });
    }, 1000);
    return () => clearInterval(timer);
  }, [room, options.keepActive, options.playing, send]);
  const create = () => {
    seed.current = handlers.current.getWorld();
    const id = crypto.randomUUID(); const url = new URL(location.href);
    url.searchParams.set("room", id); url.hash = "";
    window.history.replaceState(null, "", url); setRoom(id);
  };
  const leave = () => {
    const url = new URL(location.href); url.searchParams.delete("room");
    window.history.replaceState(null, "", url);
    setRoom(""); setStatus("offline"); setSelf(""); setParticipants([]); setFlashes([]);
    setSoundPlayers(0);
  };
  const submit = (before: World, after: World) => {
    if (!room) return false;
    if (status !== "connected") { options.notify("연결 후 편집할 수 있어요."); return true; }
    try {
      const edits = diffWorld(before, after);
      if (edits.length) send({ type: "edit", id: crypto.randomUUID(), group: crypto.randomUUID(), edits });
    } catch (e) { options.notify(e instanceof Error ? e.message : "편집을 전송하지 못했어요."); }
    return true;
  };
  const paint = (cells: number[], erase: boolean, settings: { layer: "tiles" | "symbols"; surface: Surface; terrainTool: TerrainTool; selectedAsset: string }) => {
    if (status !== "connected" || !sharedWorld.current || !cells.length) return;
    const world = sharedWorld.current;
    stroke.current ??= { id: crypto.randomUUID(), cells: new Set(), hole: !isHole(world.terrain?.tiles[cells[0]]) };
    const fresh = cells.filter(i => !stroke.current!.cells.has(i));
    for (const i of fresh) stroke.current.cells.add(i);
    if (!fresh.length) return;
    send({ type: "edit", id: crypto.randomUUID(), group: stroke.current.id, paint: {
      layer: settings.layer, surface: settings.surface, tool: settings.terrainTool, asset: settings.selectedAsset,
      erase, hole: stroke.current.hole, cells: fresh.map(index => ({ index, objectId: world.objects.find(o => o.z * world.size + o.x === index)?.id })),
    } });
  };
  return { room, enabled: !!room, status, participants, soundPlayers, self, flashes, ...history, create, leave, submit, paint,
    endStroke: () => { stroke.current = null; },
    undo: () => send({ type: "undo", id: crypto.randomUUID() }),
    redo: () => send({ type: "redo", id: crypto.randomUUID() }),
    cursor: useCallback((cell: number | null) => { if (cursor.current !== cell) { cursor.current = cell; presence(); } }, [presence]),
    frame: useCallback((frame: PlayerAudioFrame) => {
      lastFrame.current = { frame, revision: revision.current };
      if (active.current) send({ type: "frame", frame, revision: revision.current });
    }, [send]),
  };
}
