import { useCallback, useEffect, useRef, useState } from "react";
import { localMeetingView, retireOfflineMeetingFootings, type MeetingMessage, type MeetingPresence, type MeetingPosition, type MeetingWhistle } from "@/lib/meeting";
import { createMeetingCodec } from "@/lib/meeting-wire";
import type { World } from "@/lib/world";
import { meetingSocketURL } from "@/lib/meeting-client";
import type { MeteorClock } from "@/lib/meteors";

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
  const socket = useRef<WebSocket | null>(null);
  const online = useRef(false);
  const lastPosition = useRef<MeetingPosition | null>(null);
  const codec = useRef(createMeetingCodec());
  const resetId = useRef(0);
  const nightSky = useRef(false);
  const meteorClock = useRef<MeteorClock | undefined>(undefined);
  const listeners = useRef(new Set<(event: MeetingWhistle) => void>());
  useEffect(() => {
    if (!enabled) return;
    let stopped = false, delay = 1000;
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
      connecting = setTimeout(() => ws.close(), 15_000);
      codec.current = createMeetingCodec();
      ws.onopen = () => {
        for (const frame of codec.current.encode({type:"night-sky",eligible:nightSky.current})) ws.send(frame);
      };
      ws.onmessage = event => {
        if (stopped || socket.current !== ws) return;
        let message: MeetingMessage | null;
        try { message = codec.current.decode<MeetingMessage>(event.data); }
        catch (error) { setError((error as Error).message); return; }
        if (!message) return;
        if (message.type === "error") {
          setError(message.message);
          if (message.world) setRejected(previous => ({world:message.world!,revision:(previous?.revision ?? 0)+1}));
          return;
        }
        if (message.type === "whistle") { listeners.current.forEach(listener => listener(message.whistle)); return; }
        online.current=true;
        setStatus("online"); setPresence(message.presence);
        if (message.presence.meteors) meteorClock.current = {
          timeline: message.presence.meteors.timeline, server: message.presence.meteors.now, local: performance.now(),
        };
        if(message.presence.turn)setTurnClock({server:message.presence.turn.serverNow,local:performance.now()});
        if (message.type === "state") {
          clearTimeout(connecting);
          delay = 1000;
          resetId.current = message.view.reset.id;
          setError("");
          setView(message.view);
        }
      };
      ws.onclose = event => {
        clearTimeout(connecting);
        if (stopped || socket.current !== ws) return;
        online.current=false;
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
    return () => { stopped = true; clearTimeout(retry); clearTimeout(connecting); socket.current?.close(); socket.current = null; online.current=false; };
  }, [key,session,enabled]);
  const send = useCallback((message: object) => {
    if (socket.current?.readyState === WebSocket.OPEN) {
      try { for (const frame of codec.current.encode(message)) socket.current.send(frame); }
      catch (error) { setError((error as Error).message); }
    }
  }, []);
  const restart = useCallback((world:World) => {
    send({type:"leave"});
    socket.current?.close();socket.current=null;
    online.current=false;lastPosition.current=null;
    const next=identity(key,true);
    resetId.current=0;
    setView(localMeetingView(next.id,world));
    setPresence({peers:[],canWhistle:false});setStatus(enabled?"connecting":"offline");setError("");setSession(next);
  },[key,send,enabled]);
  const setMultiplayer = useCallback((next:boolean, world:World) => {
    if (next === enabled) return;
    if (!next) restart({...world,connectionFootings:[]});
    setEnabled(next);
    setStatus(next ? "connecting" : "offline");
  }, [enabled,restart]);
  const position = useCallback((player: MeetingPosition, playing: boolean) => {
    lastPosition.current=player;
    if(!online.current)setView(current=>retireOfflineMeetingFootings(current,player));
    send({ type: "position", player, playing, resetId:resetId.current });
  }, [send]);
  const sky = useCallback((eligible: boolean) => {
    if (nightSky.current === eligible) return;
    nightSky.current = eligible;
    send({type:"night-sky",eligible});
  }, [send]);
  const subscribeWhistle = useCallback((listener: (event: MeetingWhistle) => void) => {
    listeners.current.add(listener);
    return () => { listeners.current.delete(listener); };
  }, []);
  return { key, documentId, view, presence, status, error, enabled, setMultiplayer, send, restart, position, subscribeWhistle, rejected, turnClock, meteorClock, sky };
}
