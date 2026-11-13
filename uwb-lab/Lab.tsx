import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Scene from "../components/whistle/Scene";
import { createSimulation } from "../lib/world";
import { createWorldDeriver } from "../lib/world-derivation";
import { createPdSession, validateBoardHeight, type PdSession } from "../lib/audio/webpd-session";
import { roomPositionAt, sampleTrackedPosition, type RoomMapping } from "../lib/uwb-position";
import { createLabWorld } from "./world";
import { useLiveWorld } from "./useLiveWorld";

const initialMapping: RoomMapping = { originX: 0, originZ: 0, width: 6, depth: 6, rotation: 0 };
const labels: Record<keyof RoomMapping, string> = {
  originX: "원점 X (m)", originZ: "원점 Z (m)", width: "가로 (m)", depth: "세로 (m)", rotation: "회전 (°)",
};
const statusLabels = { tracking: "위치 연결됨", outside: "공간 범위 밖 · 오디오 정지", "no-ground": "바닥 없음 · 오디오 정지" };

export default function Lab() {
  const [world, setWorld] = useState(createLabWorld);
  const [mapping, setMapping] = useState(initialMapping);
  const [position, setPosition] = useState({ x: 1, z: 3 });
  const [boardHeight, setBoardHeight] = useState(0);
  const [packet, setPacket] = useState('{"x":1,"z":3,"boardHeight":0}');
  const [inputError, setInputError] = useState("");
  const [audioState, setAudioState] = useState<"off" | "loading" | "on">("off");
  const [audioError, setAudioError] = useState("");
  const [received, setReceived] = useState<Record<string, (string | number)[]>>({});
  const session = useRef<PdSession | null>(null);
  const generation = useRef(0);
  const live = useLiveWorld(setWorld);
  const liveActive = useRef(live.active);
  liveActive.current = live.active;
  const derive = useMemo(createWorldDeriver, []);
  const derivation = useMemo(() => derive(world), [derive, world]);
  const simulation = useMemo(() => createSimulation(world), [world]);
  const sample = useMemo(() => {
    try {
      if (live.active && live.status !== "connected" && live.status !== "saved") throw new Error("편집기 연결 대기 · 위치 적용 중지");
      if (inputError) throw new Error(inputError);
      return { value: sampleTrackedPosition(world, derivation, position, mapping), error: "" };
    } catch (error) {
      return { value: null, error: error instanceof Error ? error.message : "좌표 입력 오류" };
    }
  }, [world, derivation, position, mapping, inputError, live.active, live.status]);
  let heightError = "";
  try { validateBoardHeight(boardHeight); }
  catch (error) { heightError = (error as Error).message; }

  const stopAudio = useCallback(() => {
    generation.current++;
    const previous = session.current;
    session.current = null;
    setAudioState("off");
    if (previous) {
      previous.stopPlayer();
      previous.mute(true);
      void previous.close().catch(() => setAudioError("오디오 종료 실패"));
    }
  }, []);

  useEffect(() => {
    const current = session.current;
    if (!current || audioState !== "on") return;
    if (sample.value?.sound && !heightError) {
      current.boardHeight(boardHeight);
      current.player(sample.value.sound);
      current.mute(false);
    } else {
      current.stopPlayer();
      current.mute(true);
    }
  }, [sample, audioState, boardHeight, heightError]);

  useEffect(() => {
    const blur = () => { if (!liveActive.current) stopAudio(); };
    const hidden = () => { if (document.hidden) blur(); };
    window.addEventListener("blur", blur);
    window.addEventListener("pagehide", stopAudio);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("blur", blur);
      window.removeEventListener("pagehide", stopAudio);
      document.removeEventListener("visibilitychange", hidden);
      generation.current++;
      void session.current?.close();
      session.current = null;
    };
  }, [stopAudio]);

  async function startAudio() {
    const request = ++generation.current;
    setAudioState("loading");
    setAudioError("");
    setReceived({});
    try {
      const created = await createPdSession(`${import.meta.env.BASE_URL}audio-test/`, (bus, message) => {
        if (request === generation.current) setReceived((previous) => ({ ...previous, [bus]: message }));
      });
      if (request !== generation.current) { await created.close(); return; }
      session.current = created;
      setAudioState("on");
    } catch (error) {
      if (request !== generation.current) return;
      setAudioState("off");
      setAudioError(error instanceof Error ? error.message : "오디오 시작 실패");
    }
  }

  function selectSample() {
    live.disconnect();
    stopAudio();
    setReceived({});
    setWorld(createLabWorld());
  }

  function moveTo(u: number, v: number) {
    setInputError("");
    setPosition(roomPositionAt(u, v, mapping));
  }
  const frame = sample.value?.frame;
  const grid = sample.value?.grid;
  const mappingValid = Object.values(mapping).every(Number.isFinite) && mapping.width > 0 && mapping.depth > 0;
  const readout = sample.value ? { status: sample.value.status, metres: position,
    boardHeight: heightError ? null : boardHeight,
    grid: sample.value.grid, pd: sample.value.sound } : { error: sample.error };

  return <main>
    <header><h1>UWB 위치 테스트</h1></header>
    <section className="world-controls" aria-label="세계 선택">
      <nav className="world-menu" aria-label="테스트 세계">
        <button aria-pressed={!live.active} onClick={selectSample}>샘플 세계</button>
        <button aria-pressed={live.active} onClick={() => {
          if (!live.active) stopAudio();
          live.connect();
        }}>Whistle 3D</button>
      </nav>
    </section>
    <div className="layout">
      <section className="views" aria-label="가상공간">
        {live.active ? <p id="live-status" role="status">{live.error || ({ off: "", saved: "Whistle 3D", waiting: "Whistle 편집기를 열어 주세요.",
          connected: "편집 중인 세계에 연결됨", disconnected: "편집기 연결 끊김 · 오디오 정지", unavailable: "편집기 세계를 불러오지 못함 · 오디오 정지" })[live.status]}</p> : null}
        <h2>{world.title}</h2>
        <Scene world={world} simulation={simulation} derivation={derivation} mode="overview"
          trackedPosition={frame ? { x: frame.x, y: frame.y, z: frame.z } : null} />
        <p>평면도를 클릭하거나 드래그해 이동하세요. 왼쪽 위가 원점이고 오른쪽은 +X, 아래쪽은 +Z입니다.</p>
        <button className="map" aria-label="관객 위치 평면도" disabled={!mappingValid}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            const rect = event.currentTarget.getBoundingClientRect();
            moveTo(Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
              Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)));
          }}
          onPointerMove={(event) => {
            if (!event.buttons) return;
            const rect = event.currentTarget.getBoundingClientRect();
            moveTo(Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
              Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)));
          }}
          onClick={(event) => { if (event.detail === 0) moveTo(0.5, 0.5); }}>
          <svg viewBox={`0 0 ${world.size} ${world.size}`} aria-hidden="true">
            {world.terrain?.tiles.map((tile, i) => <rect key={i} x={i % world.size} y={Math.floor(i / world.size)}
              width="1" height="1" fill={tile.hole ? "#272b2a" : ({ plain: "#ddd9cd", soft: "#b5cc9c", rough: "#aaa9a5", slick: "#a7cdd9" })[tile.surface]}
              stroke="#ffffff" strokeWidth="0.025" />)}
            {grid ? <circle data-testid="position-marker" cx={grid.x + 0.5} cy={grid.z + 0.5} r="0.2" fill="#e34d35" stroke="white" strokeWidth="0.07" /> : null}
          </svg>
        </button>
        <p>평면도 색상: 연두 = 부드러운 지면, 회색 = 거친 지면, 파랑 = 미끄러운 지면. 실제 풀·물 상태는 아래 계산값을 확인하세요.</p>
      </section>
      <section className="controls" aria-label="위치 입력">
        <section className="audio-controls" aria-label="오디오">
        <button onClick={() => void startAudio()} disabled={audioState !== "off" || !frame || !!heightError}>오디오 시작</button>
        <button onClick={stopAudio} disabled={audioState === "off"}>오디오 종료</button>
        <p id="audio-status" role="status">{audioError || ({ off: "오디오 꺼짐", loading: "패치 준비 중", on: "오디오 실행 중" })[audioState]}</p>
        </section>
        <fieldset><legend>전시장 매핑</legend>
          {(Object.keys(labels) as (keyof RoomMapping)[]).map((key) => <label key={key}>{labels[key]}
            <input type="number" step="any" value={Number.isFinite(mapping[key]) ? mapping[key] : ""}
              onChange={(event) => setMapping({ ...mapping, [key]: event.target.valueAsNumber })} /></label>)}
          <p>입력 좌표를 원점·회전으로 보정한 뒤 가로·세로에 맞춰 전체 격자에 매핑합니다.</p>
        </fieldset>
        <fieldset><legend>가상 UWB 입력 · 미터</legend>
          {(["x", "z"] as const).map((axis) => <label key={axis}>관객 {axis.toUpperCase()} (m)
            <input type="number" step="0.1" value={Number.isFinite(position[axis]) ? position[axis] : ""}
              onChange={(event) => { setInputError(""); setPosition({ ...position, [axis]: event.target.valueAsNumber }); }} /></label>)}
          <label>보드 높이 (m)
            <input type="number" min="0" max="10" step="0.1" value={Number.isFinite(boardHeight) ? boardHeight : ""}
              onChange={(event) => { setInputError(""); setBoardHeight(event.target.valueAsNumber); }} /></label>
          <p>현실 바닥 기준 보드 높이입니다. 시험 범위는 0~10m이며, 3D 표식·지형·플레이어 높이는 바꾸지 않습니다.</p>
          <p id="height-status" role="status">{heightError ? `${heightError} · 오디오 정지` : ""}</p>
          <div>{["왼쪽", "중앙", "오른쪽"].map((name, i) => <button key={name} disabled={!mappingValid}
            onClick={() => moveTo((i + 0.5) / 3, 0.5)}>{name} 위치</button>)}</div>
          <label className="packet" htmlFor="coordinate-json">좌표 JSON</label>
          <textarea id="coordinate-json" value={packet} onChange={(event) => setPacket(event.target.value)} />
          <button onClick={() => {
            try {
              const value: unknown = JSON.parse(packet);
              if (!value || typeof value !== "object" || !("x" in value) || !("z" in value)
                || typeof value.x !== "number" || typeof value.z !== "number"
                || !Number.isFinite(value.x) || !Number.isFinite(value.z)) throw new Error("JSON에는 유한한 숫자 x, z가 필요합니다.");
              if ("boardHeight" in value) {
                if (typeof value.boardHeight !== "number") throw new Error("보드 높이는 0~10m 사이의 유한한 숫자여야 합니다.");
                validateBoardHeight(value.boardHeight);
                setBoardHeight(value.boardHeight);
              }
              setPosition({ x: value.x, z: value.z }); setInputError("");
            } catch (error) { setInputError(error instanceof SyntaxError ? "JSON에는 유한한 숫자 x, z가 필요합니다." : (error as Error).message); }
          }}>좌표 적용</button>
          <p>JSON의 boardHeight는 미터 단위이며, 생략하면 현재 보드 높이를 유지합니다.</p>
          <p>위치 계산이 끝난 좌표를 시험 입력합니다. 실제 UWB 연결·거리 측정은 아직 포함하지 않습니다.</p>
        </fieldset>
        <p id="tracking-status" role="status">{sample.error || (sample.value && statusLabels[sample.value.status])}</p>
        <dl><dt>풀</dt><dd id="grass">{frame?.grass.toFixed(3) ?? "—"}</dd>
          <dt>바위 지면</dt><dd id="rough">{frame?.rough.toFixed(3) ?? "—"}</dd>
          <dt>물</dt><dd id="water">{frame ? (frame.water ? "물속" : "마른 지면") : "—"}</dd></dl>
        <p>Pd 시험음은 위치·풀·바위와 보드 높이에 따라 변합니다. 보드 높이 1m마다 음높이가 110Hz 올라가며, 0m는 기존 소리입니다. 물은 수신값만 확인합니다.
          {live.active ? " 실시간 연결 중에는 편집기로 이동해도 소리를 유지합니다. 오디오 종료 버튼으로 멈출 수 있습니다." : " 창을 벗어나면 종료됩니다."}</p>
        <details open><summary>변환 결과</summary><pre id="position-data">{JSON.stringify(readout, null, 2)}</pre></details>
        <details><summary>Pd가 수신한 값</summary><pre id="pd-messages">{JSON.stringify(received, null, 2)}</pre></details>
      </section>
    </div>
  </main>;
}
