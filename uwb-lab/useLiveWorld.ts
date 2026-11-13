import { useCallback, useEffect, useRef, useState } from "react";
import { validateWorld, type World } from "../lib/world";
import { upgradeTerrain } from "../lib/terrain";
import { LIVE_WORLD_CHANNEL } from "../lib/live-world";

type Status = "off" | "saved" | "waiting" | "connected" | "disconnected" | "unavailable";

export function useLiveWorld(receive: (world: World) => void) {
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState<Status>("off");
  const [error, setError] = useState("");
  const receiveRef = useRef(receive);
  receiveRef.current = receive;

  const disconnect = useCallback(() => {
    setActive(false);
    setStatus("off");
    setError("");
  }, []);
  const connect = useCallback(() => setActive(true), []);

  useEffect(() => {
    if (!active) return;
    let source: string | null = null;
    let lastSeen = performance.now();
    const loadSaved = () => {
      try {
        const stored = localStorage.getItem("whistle.world.v2");
        if (stored === null) {
          setStatus("waiting");
        } else {
          receiveRef.current(upgradeTerrain(validateWorld(JSON.parse(stored))));
          setStatus("saved");
        }
        setError("");
      } catch {
        setStatus("unavailable");
        setError("Whistle 세계를 불러오지 못했습니다.");
      }
    };
    loadSaved();
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(LIVE_WORLD_CHANNEL);
    if (channel) channel.onmessage = ({ data }) => {
      if (typeof data?.source !== "string") return;
      if (data.type === "world") {
        try {
          const world = validateWorld(data.world);
          receiveRef.current(world);
          source = data.source;
          lastSeen = performance.now();
          setStatus("connected");
          setError("");
        } catch {
          if (!source || source === data.source) {
            setStatus("unavailable");
            setError("편집기에서 받은 세계가 올바르지 않습니다.");
          }
        }
      } else if (!source || source === data.source) {
        if (data.type === "alive") {
          lastSeen = performance.now();
        } else if (data.type === "unavailable") {
          setStatus("unavailable");
        } else if (data.type === "closed" && source === data.source) {
          source = null;
          setStatus("disconnected");
        }
      }
    };
    const request = () => {
      if (source && performance.now() - lastSeen > 5000) {
        source = null;
        setStatus("disconnected");
      }
      channel?.postMessage(source ? { type: "ping", target: source } : { type: "request" });
    };
    request();
    const timer = setInterval(request, 1000);
    const visible = () => {
      if (!document.hidden) channel?.postMessage({ type: "request" });
    };
    const saved = (event: StorageEvent) => {
      if (!source && (event.key === "whistle.world.v2" || event.key === null)) loadSaved();
    };
    window.addEventListener("storage", saved);
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearInterval(timer);
      window.removeEventListener("storage", saved);
      document.removeEventListener("visibilitychange", visible);
      channel?.close();
    };
  }, [active]);

  return { active, status, error, connect, disconnect };
}
