import { useCallback, useEffect, useRef, useState } from "react";
import { validateWorld, type World } from "../lib/world";
import { LIVE_WORLD_QUERY, liveWorldChannel } from "../lib/live-world";

type Status = "off" | "waiting" | "connected" | "disconnected" | "unavailable";

export function useLiveWorld(receive: (world: World) => void) {
  const [session, setSession] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("off");
  const [error, setError] = useState("");
  const [updates, setUpdates] = useState(0);
  const editor = useRef<Window | null>(null);
  const receiveRef = useRef(receive);
  receiveRef.current = receive;

  const disconnect = useCallback(() => {
    setSession(null);
    setStatus("off");
    setError("");
    editor.current = null;
  }, []);

  function openEditor() {
    if (session && editor.current && !editor.current.closed) {
      editor.current.focus();
      return;
    }
    if (typeof BroadcastChannel === "undefined") {
      setError("이 브라우저에서는 실시간 연결을 지원하지 않습니다.");
      return;
    }
    const id = crypto.randomUUID();
    const url = new URL(import.meta.env.BASE_URL, location.origin);
    url.searchParams.set(LIVE_WORLD_QUERY, id);
    const opened = window.open(url.href, `whistle-editor-${id}`);
    if (!opened) {
      setError("편집기 창을 열지 못했습니다. 팝업 허용 후 다시 눌러 주세요.");
      return;
    }
    editor.current = opened;
    setError("");
    setUpdates(0);
    setStatus("waiting");
    setSession(id);
  }

  useEffect(() => {
    if (!session) return;
    const channel = new BroadcastChannel(liveWorldChannel(session)!);
    let receivedWorld = false;
    let lastSeen = performance.now();
    const invalidate = (next: Status) => {
      receivedWorld = false;
      setStatus(next);
    };
    channel.onmessage = ({ data }) => {
      if (data?.type === "world") {
        try {
          const world = validateWorld(data.world);
          receiveRef.current(world);
          receivedWorld = true;
          lastSeen = performance.now();
          setStatus("connected");
          setError("");
          setUpdates((value) => value + 1);
        } catch {
          invalidate("unavailable");
          setError("편집기에서 받은 세계가 올바르지 않습니다.");
        }
      } else if (data?.type === "alive") {
        lastSeen = performance.now();
        if (!receivedWorld) channel.postMessage({ type: "request" });
      } else if (data?.type === "unavailable") {
        lastSeen = performance.now();
        invalidate("unavailable");
      } else if (data?.type === "closed") {
        invalidate("disconnected");
      }
    };
    const request = () => {
      if (editor.current?.closed || performance.now() - lastSeen > 5000) invalidate("disconnected");
      channel.postMessage({ type: receivedWorld ? "ping" : "request" });
    };
    request();
    const timer = setInterval(request, 1000);
    const visible = () => { if (!document.hidden) channel.postMessage({ type: "request" }); };
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
      channel.onmessage = null;
      channel.close();
    };
  }, [session]);

  return { active: session !== null, status, error, updates, openEditor, disconnect };
}
