import { useState } from "react";
import { useLanguage } from "./Language";
import type { Peer } from "@/lib/multiplayer/protocol";

type Props = {
  room: string; status: "offline" | "connecting" | "connected" | "failed";
  participants: Peer[]; self: string; playing: boolean;
  soundPlayers: number;
  onCreate: () => void; onLeave: () => void; onVolume: (value: number) => void;
  localSoundTest: { available: boolean; enabled: boolean; change: (value: boolean) => void };
};
export function MultiplayerBar({ room, status, participants, soundPlayers, self, playing, onCreate, onLeave, onVolume, localSoundTest }: Props) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false), [volume, setVolume] = useState(65);
  const [copyError, setCopyError] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(location.href); setCopied(true); setCopyError(false); }
    catch { setCopyError(true); }
  };
  const testOption = localSoundTest.available && <label className="local-sound-test"
    title={t("각 창에서 켜세요. 창 전환 중에도 3D 접속과 소리를 유지합니다.")}>
    <input type="checkbox" checked={localSoundTest.enabled} onChange={e => localSoundTest.change(e.target.checked)} />
    {t("로컬 테스트: 백그라운드 소리 유지")}
  </label>;
  if (!room) return <div className="multiplayer-bar" hidden={playing}>
    <button onClick={onCreate}>{t("함께 만들기")}</button>
    <span>{t("방 링크로 친구를 초대하세요")}</span>
    {testOption}
  </div>;
  return <section className={`multiplayer-bar ${playing ? "multiplayer-playing" : ""}`} aria-label={t("함께 만들기")}>
    <span role="status">{t(status === "connected" ? "함께 만드는 중" : status === "connecting" ? "방에 연결 중" : "연결이 끊겼어요")}</span>
    <div className="participants" aria-label={t("접속자")}>
      {participants.map(peer => <span key={peer.id} className="participant" data-peer-id={peer.id} data-peer-color={peer.color}>
        <i style={{ background: peer.color }} aria-hidden="true" />
        {peer.number}{peer.id === self ? ` · ${t("나")}` : ""}
        <small>{!peer.active ? t("자리 비움") : peer.mode === "play" ? "3D" : "2D"}</small>
      </span>)}
    </div>
    {status === "connected" && <button onClick={() => void copy()}>{t(copied ? "복사됨" : "방 링크 복사")}</button>}
    {status === "failed" && <button onClick={() => location.reload()}>{t("다시 연결")}</button>}
    <button onClick={onLeave}>{t("방 나가기")}</button>
    {testOption}
    {playing && <span className="interaction-mode" data-sound-players={soundPlayers}>
      {t("상호작용 소리")} · {t(["대기", "1인 단음", "2인 화음", "3인 화음", "4인 이상 리듬"][Math.min(4, soundPlayers)])}
    </span>}
    {playing && <label className="remote-volume">{t("다른 사람의 소리")}
      <input type="range" min="0" max="100" value={volume} onChange={e => { const next = Number(e.target.value); setVolume(next); onVolume(next / 100); }} />
    </label>}
    {copyError && <input aria-label={t("방 링크")} readOnly value={location.href} onFocus={e => e.currentTarget.select()} />}
    {!playing && <small className="room-note">{t("최대 8명 · 링크를 받은 사람은 편집할 수 있어요. 서버 종료 시 방이 사라지므로 파일로 보관하세요.")}</small>}
  </section>;
}
