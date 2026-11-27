import { useCallback, useEffect, useRef, useState } from "react";
import { localMeetingView, retireOfflineMeetingFootings, type MeetingMessage, type MeetingPresence, type MeetingPosition, type MeetingWhistle } from "@/lib/meeting";
import { createMeetingCodec } from "@/lib/meeting-wire";
import type { World } from "@/lib/world";
import { meetingSocketURL, sameMeetingPosition, sameMeetingPresence, resumeMeetingPosition } from "@/lib/meeting-client";
import { TURN_HINT } from "@/lib/workshop";
import { TURN_TILE_HINT } from "@/lib/turn-tiles";
import { MeetingTrail } from "@/lib/meeting-trail";

const createId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2,"0")).join("");
function identity(key:string, fresh=false) {
  const storageKey=`whistle.meeting.${key}.id`;
  let id=createId(),token=createId();
  try {
    if(!fresh){id=sessionStorage.getItem(storageKey)||id;token=sessionStorage.getItem(`${storageKey}.token`)||token;}
    sessionStorage.setItem(storageKey,id);sessionStorage.setItem(`${storageKey}.token`,token);
  } catch {}
  return {id,token};
}
export function useMeetingRoom(key: string) {
  const [enabled, setEnabled] = useState(true);
  const [session,setSession]=useState(()=>identity(key));
  const [documentId]=useState(()=>{
    try {
      const id=sessionStorage.getItem("whistle.document.tab")||session.id;
      sessionStorage.setItem("whistle.document.tab",id);return id;
    } catch {return session.id;}
  });
  const [view, setView] = useState(()=>localMeetingView(session.id));
  const [presence, setPresence] = useState<MeetingPresence>({ peers: [], canWhistle: false });
  const [status, setStatus] = useState<"connecting" | "online" | "offline">("connecting");
  const [error, setError] = useState("");
  const [rejected, setRejected] = useState<{world: World; revision: number} | null>(null);
  const [turnClock, setTurnClock] = useState({ server: Date.now(), local: performance.now() });
  const [peerTrail] = useState(() => new MeetingTrail());
  const socket = useRef<WebSocket | null>(null);
  const online = useRef(false);
  const lastPosition = useRef<MeetingPosition | null>(null);
  const lastSent = useRef<{ player: MeetingPosition; playing: boolean; reset: number } | null>(null);
  const lastPresence = useRef<MeetingPresence | null>(null);
  const codec = useRef<ReturnType<typeof createMeetingCodec> | null>(null);
  const resetId = useRef(0);
  const listeners = useRef(new Set<(event: MeetingWhistle) => void>());
  useEffect(() => {
    if (!enabled) return;
    let stopped = false, delay = 1000;
    let partner: string | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined, connecting: ReturnType<typeof setTimeout> | undefined;
    const {id,token}=session;
    const connect = () => {
      if (stopped) return;
      setStatus("connecting");
      let ws: WebSocket;
      try {
        const url = meetingSocketURL(new URL(location.href), import.meta.env.VITE_MEETING_SERVER_URL);
        url.searchParams.set("room", key); url.searchParams.set("id", id); url.searchParams.set("token",token);
        ws = new WebSocket(url);
      } catch {
        setStatus("offline");setError("연결 서버 주소를 확인해 주세요.");return;
      }
      socket.current = ws;
      partner = undefined;
      lastSent.current = null;
      lastPresence.current = null;
      connecting = setTimeout(() => ws.close(), 15_000);
      const connectionCodec = createMeetingCodec();
      codec.current = connectionCodec;
      ws.onmessage = event => {
        if (stopped || socket.current !== ws) return;
        let message: MeetingMessage | null;
        try { message = connectionCodec.decode<MeetingMessage>(event.data); }
        catch (error) { setError((error as Error).message); return; }
        if (!message) return;
        if (message.type === "error") {
          if (message.message !== TURN_HINT && message.message !== TURN_TILE_HINT) setError(message.message);
          if (message.world) setRejected(previous => ({world:message.world!,revision:(previous?.revision ?? 0)+1}));
          return;
        }
        if (message.type === "whistle") { listeners.current.forEach(listener => listener(message.whistle)); return; }
        if (message.type === "state") partner = message.view.recipients[0];
        peerTrail.receive(message.presence, id, partner, performance.now());
        online.current=true;
        setStatus("online");
        const previous = lastPresence.current;
        lastPresence.current = message.presence;
        if (!previous || !sameMeetingPresence(previous, message.presence)) setPresence(message.presence);
        if(message.presence.turn && (!previous || previous.turn?.owner !== message.presence.turn.owner || previous.turn?.endsAt !== message.presence.turn.endsAt))
          setTurnClock({server:message.presence.turn.serverNow,local:performance.now()});
        if (message.type === "state") {
          clearTimeout(connecting);
          delay = 1000;
          if (!previous) message.view = resumeMeetingPosition(message.view, lastPosition.current);
          lastSent.current = null;
          if (resetId.current !== message.view.reset.id) lastPosition.current = message.view.reset.player;
          resetId.current = message.view.reset.id;
          setError("");
          setView(message.view);
        }
      };
      ws.onclose = event => {
        clearTimeout(connecting);
        if (stopped || socket.current !== ws) return;
        peerTrail.clear();
        online.current=false;
        lastPresence.current=null;
        setPresence({peers:[],canWhistle:false});
        setView(current=>retireOfflineMeetingFootings(current,lastPosition.current??current.reset.player));
        setStatus("offline");
        if (event.code === 4001) setError("다른 창에서 이 세계를 열었습니다.");
        if (event.code !== 1008 && event.code !== 4001 && event.code !== 4002) {
          retry = setTimeout(connect, delay);
          delay = Math.min(15_000, delay * 2);
        }
      };
      ws.onerror = () => ws.close();
    };
    connect();
    return () => { stopped = true; clearTimeout(retry); clearTimeout(connecting); socket.current?.close(); socket.current = null; online.current=false; peerTrail.clear(); };
  }, [key,session,enabled,peerTrail]);
  const send = useCallback((message: object) => {
    if (socket.current?.readyState === WebSocket.OPEN && codec.current) {
      try { for (const frame of codec.current.encode(message)) socket.current.send(frame); return true; }
      catch (error) { setError((error as Error).message); }
    }
    return false;
  }, []);
  const restart = useCallback((world:World) => {
    send({type:"leave"});
    socket.current?.close();socket.current=null;
    online.current=false;lastPosition.current=null;
    peerTrail.clear();
    const next=identity(key,true);
    resetId.current=0;
    setView(localMeetingView(next.id,world));
    setPresence({peers:[],canWhistle:false});setStatus(enabled?"connecting":"offline");setError("");setSession(next);
  },[key,send,enabled,peerTrail]);
  const setMultiplayer = useCallback((next:boolean, world:World) => {
    if (next === enabled) return;
    if (!next) {
      const ws = socket.current;
      socket.current = null;
      ws?.close();
      online.current = false;
      peerTrail.clear();
      setView(localMeetingView(session.id, world));
      setPresence({peers:[],canWhistle:false});
      setError("");
    }
    setEnabled(next);
    setStatus(next ? "connecting" : "offline");
  }, [enabled,session.id,peerTrail]);
  const position = useCallback((player: MeetingPosition, playing: boolean) => {
    lastPosition.current=player;
    if(!online.current)setView(current=>retireOfflineMeetingFootings(current,player));
    if (!online.current || !socket.current || socket.current.bufferedAmount > 64 * 1024) return;
    const previous = lastSent.current;
    if (previous && previous.playing === playing && previous.reset === resetId.current && sameMeetingPosition(previous.player, player)) return;
    if (send({ type: "position", player, playing, resetId:resetId.current }))
      lastSent.current = { player: { ...player }, playing, reset: resetId.current };
  }, [send]);
  const subscribeWhistle = useCallback((listener: (event: MeetingWhistle) => void) => {
    listeners.current.add(listener);
    return () => { listeners.current.delete(listener); };
  }, []);
  return { key, documentId, view, presence, status, error, enabled, setMultiplayer, send, restart, position, subscribeWhistle, rejected, turnClock, peerTrail };
}
