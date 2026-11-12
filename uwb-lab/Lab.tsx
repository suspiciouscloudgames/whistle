import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Scene from "../components/whistle/Scene";
import { createSimulation, validateWorld, type World } from "../lib/world";
import { upgradeTerrain } from "../lib/terrain";
import { createWorldDeriver } from "../lib/world-derivation";
import { createPdSession, type PdSession } from "../lib/audio/webpd-session";
import { roomPositionAt, sampleTrackedPosition, type RoomMapping } from "../lib/uwb-position";
import { createLabWorld } from "./world";

const initialMapping: RoomMapping = { originX: 0, originZ: 0, width: 6, depth: 6, rotation: 0 };
const labels: Record<keyof RoomMapping, string> = {
  originX: "원점 X (m)", originZ: "원점 Z (m)", width: "가로 (m)", depth: "세로 (m)", rotation: "회전 (°)",
};
const statusLabels = { tracking: "위치 연결됨", outside: "공간 범위 밖 · 오디오 정지", "no-ground": "바닥 없음 · 오디오 정지" };

export default function Lab() {
  const [world, setWorld] = useState(createLabWorld);
  const [mapping, setMapping] = useState(initialMapping);
  const [position, setPosition] = useState({ x: 1, z: 3 });
  const [packet, setPacket] = useState('{"x":1,"z":3}');
  const [inputError, setInputError] = useState("");
  const [notice, setNotice] = useState("");
  const [audioState, setAudioState] = useState<"off" | "loading" | "on">("off");
  const [audioError, setAudioError] = useState("");
  const [received, setReceived] = useState<Record<string, (string | number)[]>>({});
  const session = useRef<PdSession | null>(null);
  const generation = useRef(0);
  const importGeneration = useRef(0);
  const derive = useMemo(createWorldDeriver, []);
  const derivation = useMemo(() => derive(world), [derive, world]);
  const simulation = useMemo(() => createSimulation(world), [world]);
  const sample = useMemo(() => {
    try {
      if (inputError) throw new Error(inputError);
      return { value: sampleTrackedPosition(world, derivation, position, mapping), error: "" };
    } catch (error) {
      return { value: null, error: error instanceof Error ? error.message : "좌표 입력 오류" };
    }
  }, [world, derivation, position, mapping, inputError]);

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
    if (sample.value?.sound) {
      current.mute(false);
      current.player(sample.value.sound);
    } else {
      current.stopPlayer();
      current.mute(true);
    }
  }, [sample, audioState]);

  useEffect(() => {
    const hidden = () => { if (document.hidden) stopAudio(); };
    window.addEventListener("blur", stopAudio);
    window.addEventListener("pagehide", stopAudio);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("blur", stopAudio);
      window.removeEventListener("pagehide", stopAudio);
      document.removeEventListener("visibilitychange", hidden);
      generation.current++;
      importGeneration.current++;
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

  function replaceWorld(next: World) {
    stopAudio();
    setReceived({});
    setWorld(next);
    setNotice(`불러옴: ${next.title}`);
  }

  function loadSaved() {
    importGeneration.current++;
    try {
      const saved = localStorage.getItem("whistle.world.v2");
      if (!saved) throw new Error("이 주소에 저장된 세계가 없습니다. 게임에서 내보낸 JSON 파일을 열어 주세요.");
      replaceWorld(upgradeTerrain(validateWorld(JSON.parse(saved))));
    } catch (error) { setNotice(error instanceof Error ? error.message : "불러오기 실패"); }
  }

  async function loadFile(file?: File) {
    if (!file) return;
    const request = ++importGeneration.current;
    try {
      if (file.size > 6_000_000) throw new Error("6MB 이하의 세계 파일을 선택해 주세요.");
      const next = upgradeTerrain(validateWorld(JSON.parse(await file.text())));
      if (request === importGeneration.current) replaceWorld(next);
    } catch (error) {
      if (request === importGeneration.current) setNotice(error instanceof Error ? error.message : "불러오기 실패");
    }
  }

  function moveTo(u: number, v: number) {
    setInputError("");
    setPosition(roomPositionAt(u, v, mapping));
  }
  const frame = sample.value?.frame;
  const grid = sample.value?.grid;
  const mappingValid = Object.values(mapping).every(Number.isFinite) && mapping.width > 0 && mapping.depth > 0;
  const readout = sample.value ? { status: sample.value.status, metres: position,
    grid: sample.value.grid, pd: sample.value.sound } : { error: sample.error };

  return <main>
    <header><a href={import.meta.env.BASE_URL}>Whistle</a><h1>UWB 위치 테스트</h1>
      <p>장비 없이 관객 1명의 위치를 움직여 가상공간과 소리의 연결을 확인합니다. 빨간 표식이 관객 위치입니다.</p></header>
    <section className="world-controls" aria-label="세계 선택">
      <button onClick={() => { importGeneration.current++; replaceWorld(createLabWorld()); }}>샘플 세계</button>
      <button onClick={loadSaved}>저장된 세계 읽기</button>
      <label>세계 JSON 파일<input type="file" accept=".json,application/json" onChange={(event) => {
        void loadFile(event.target.files?.[0]); event.target.value = "";
      }} /></label>
      <p>이 페이지는 기존 세계를 읽기만 합니다. 다른 서버 주소에서 만든 세계는 JSON 파일로 가져오세요.</p>
      <p role="status">{notice}</p>
    </section>
    <div className="layout">
      <section className="views" aria-label="가상공간">
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
          <div>{["왼쪽", "중앙", "오른쪽"].map((name, i) => <button key={name} disabled={!mappingValid}
            onClick={() => moveTo((i + 0.5) / 3, 0.5)}>{name} 위치</button>)}</div>
          <label className="packet" htmlFor="coordinate-json">좌표 JSON</label>
          <textarea id="coordinate-json" value={packet} onChange={(event) => setPacket(event.target.value)} />
          <button onClick={() => {
            try {
              const value: unknown = JSON.parse(packet);
              if (!value || typeof value !== "object" || !("x" in value) || !("z" in value)
                || typeof value.x !== "number" || typeof value.z !== "number"
                || !Number.isFinite(value.x) || !Number.isFinite(value.z)) throw new Error("JSON에는 숫자 x, z가 필요합니다.");
              setPosition({ x: value.x, z: value.z }); setInputError("");
            } catch { setInputError("JSON에는 유한한 숫자 x, z가 필요합니다."); }
          }}>좌표 적용</button>
          <p>위치 계산이 끝난 좌표를 시험 입력합니다. 실제 UWB 연결·거리 측정은 아직 포함하지 않습니다.</p>
        </fieldset>
        <p id="tracking-status" role="status">{sample.error || (sample.value && statusLabels[sample.value.status])}</p>
        <dl><dt>풀</dt><dd id="grass">{frame?.grass.toFixed(3) ?? "—"}</dd>
          <dt>바위 지면</dt><dd id="rough">{frame?.rough.toFixed(3) ?? "—"}</dd>
          <dt>물</dt><dd id="water">{frame ? (frame.water ? "물속" : "마른 지면") : "—"}</dd></dl>
        <button onClick={() => void startAudio()} disabled={audioState !== "off" || !frame}>오디오 시작</button>
        <button onClick={stopAudio} disabled={audioState === "off"}>오디오 종료</button>
        <p id="audio-status" role="status">{audioError || ({ off: "오디오 꺼짐", loading: "패치 준비 중", on: "오디오 실행 중" })[audioState]}</p>
        <p>기존 Pd 시험음입니다. 위치·풀·바위에 따라 변하며, 물은 수신값만 확인합니다. 창을 벗어나면 종료됩니다.</p>
        <details open><summary>변환 결과</summary><pre id="position-data">{JSON.stringify(readout, null, 2)}</pre></details>
        <details><summary>Pd가 수신한 값</summary><pre id="pd-messages">{JSON.stringify(received, null, 2)}</pre></details>
      </section>
    </div>
  </main>;
}
