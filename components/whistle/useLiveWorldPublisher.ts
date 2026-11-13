import { useEffect, useRef } from "react";
import type { World } from "../../lib/world";
import { LIVE_WORLD_QUERY, liveWorldChannel } from "../../lib/live-world";

export function useLiveWorldPublisher(world: World, ready: boolean) {
  const current = useRef({ world, ready });
  current.current = { world, ready };
  const channel = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    const name = liveWorldChannel(new URLSearchParams(location.search).get(LIVE_WORLD_QUERY));
    if (!name || typeof BroadcastChannel === "undefined") return;
    const connection = new BroadcastChannel(name);
    channel.current = connection;
    const snapshot = () => connection.postMessage(current.current.ready
      ? { type: "world", world: current.current.world } : { type: "unavailable" });
    connection.onmessage = ({ data }) => {
      if (data?.type === "request") snapshot();
      if (data?.type === "ping") connection.postMessage({ type: current.current.ready ? "alive" : "unavailable" });
    };
    const leaving = () => connection.postMessage({ type: "closed" });
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
    channel.current?.postMessage(ready ? { type: "world", world } : { type: "unavailable" });
  }, [world, ready]);
}
