import { useEffect, useRef, type MutableRefObject } from "react";
import type { MeetingSession } from "./ConnectedWorld";
import type { Player } from "@/lib/world";
import type { MeetingWhistle } from "@/lib/meeting";

export function useMeetingWhistle(meeting: MeetingSession | undefined, playing: boolean, player: MutableRefObject<Player>, sound: (source: Pick<MeetingWhistle, "x" | "z">, listener: Player) => void) {
  const last = useRef(-Infinity);
  const connected = !!meeting && meeting.status === "online" && meeting.presence.canWhistle;
  const subscribe = meeting?.subscribeWhistle;
  useEffect(() => {
    if (!playing || meeting?.status !== "online") return;
    return subscribe?.(event => sound(event, player.current));
  }, [playing, meeting?.status, subscribe, sound, player]);
  const blow = () => {
    if (!playing || !connected || performance.now() - last.current < 400) return;
    last.current = performance.now();
    meeting!.position({ ...player.current, grounded: !!player.current.grounded }, true);
    meeting!.send({ type: "whistle" });
  };
  return { blow, enabled: playing && connected };
}
