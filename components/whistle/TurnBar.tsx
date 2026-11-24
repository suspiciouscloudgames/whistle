import { useEffect, useState } from "react";
import type { MeetingSession } from "./ConnectedWorld";
import { TURN_DURATION } from "@/lib/meeting";
import { useLanguage } from "./Language";

function timeLeft(endsAt: number | undefined, clock: MeetingSession["turnClock"]) {
  return endsAt === undefined ? TURN_DURATION : Math.max(0, Math.min(TURN_DURATION, endsAt - (clock.server + performance.now() - clock.local)));
}

export function useWorkshopTurn(meeting: MeetingSession) {
  const [, tick] = useState(0);
  const turn = meeting.enabled ? meeting.presence.turn : undefined;
  useEffect(() => {
    if (!turn || meeting.status !== "online" || turn.owner !== meeting.view.id) return;
    const remaining = timeLeft(turn.endsAt, meeting.turnClock);
    if (!remaining) return;
    const timer = setTimeout(() => tick(n => n + 1), remaining + 1);
    return () => clearTimeout(timer);
  }, [turn?.endsAt, turn?.owner, meeting.status, meeting.view.id, meeting.turnClock]);
  const remaining = timeLeft(turn?.endsAt, meeting.turnClock);
  const canPlace = !turn || (meeting.status === "online" && turn.owner === meeting.view.id && remaining > 0);
  return { canPlace, endsAt: turn?.endsAt, clock: meeting.turnClock };
}

export function TurnBar({ canPlace, endsAt, clock }: ReturnType<typeof useWorkshopTurn>) {
  const { t } = useLanguage();
  const [, tick] = useState(0);
  useEffect(() => {
    if (endsAt === undefined) return;
    const timer = setInterval(() => tick(n => n + 1), 100);
    return () => clearInterval(timer);
  }, [endsAt]);
  if (endsAt === undefined) return null;
  const progress = timeLeft(endsAt, clock) / TURN_DURATION;
  const label = canPlace ? "배치할 차례" : "편집할 시간";
  return <div className={`turn-status${canPlace ? " own-turn" : " other-turn"}`} data-turn={canPlace ? "own" : "other"}>
    <div className="turn-track" role="progressbar" aria-label={t("차례 남은 시간")}
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
      <div className="turn-fill" style={{ transform: `scaleX(${progress})` }} />
    </div>
    <span className="turn-label" role="status">{t(label)}</span>
  </div>;
}
