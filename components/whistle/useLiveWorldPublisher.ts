import { useEffect, useRef } from "react";
import type { World } from "../../lib/world";
import { LIVE_WORLD_CHANNEL } from "../../lib/live-world";

export function useLiveWorldPublisher(world: World, ready: boolean) {
  const current = useRef({ world, ready });
  current.current = { world, ready };
  const channel = useRef<BroadcastChannel | null>(null);
  const source = useRef("");

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    source.current = crypto.randomUUID();
    const connection = new BroadcastChannel(LIVE_WORLD_CHANNEL);
    channel.current = connection;
    const send = (type: string) => connection.postMessage({ type, source: source.current });
    const snapshot = () => connection.postMessage(current.current.ready
      ? { type: "world", source: source.current, world: current.current.world }
      : { type: "unavailable", source: source.current });
    connection.onmessage = ({ data }) => {
      if (data?.target && data.target !== source.current) return;
      if (data?.type === "request") snapshot();
      if (data?.type === "ping") send(current.current.ready ? "alive" : "unavailable");
    };
    const leaving = () => send("closed");
    window.addEventListener("pagehide", leaving);
    window.addEventListener("pageshow", snapshot);
    return () => {
      window.removeEventListener("pagehide", leaving);
      window.removeEventListener("pageshow", snapshot);
      leaving();
      connection.close();
      channel.current = null;
    };
  }, []);

  useEffect(() => {
    channel.current?.postMessage(ready
      ? { type: "world", source: source.current, world }
      : { type: "unavailable", source: source.current });
  }, [world, ready]);
}
