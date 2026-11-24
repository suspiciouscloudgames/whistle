"use client";
// 3D 플레이 화면 위에 디버그 정보를 글자로 겹쳐 보인다.
// 3D 플레이 중 ` (백틱, 숫자 1 왼쪽) 키로 켜고 끈다(기본은 꺼짐). 켜면 오른쪽 위에 보인다.
// 키는 자판 위치(code)로 본다: 한/영 입력 상태와 상관없이 같은 키.
// 켜져 있을 때만 0.25초마다 읽는다. 유성우 테스트 입력과 시청각 동기화는 Scene에서 처리한다.
import { useEffect, useRef, useState } from "react";
import type { GameAudioDebug } from "@/components/whistle/useGameAudio";
import type { World } from "@/lib/world";
import type { WorldDerivation } from "@/lib/world-derivation";
import { isHole } from "@/lib/tile";
import { renderQuality } from "@/lib/render-quality";

const TOGGLE_CODE = "Backquote";
const REFRESH_MS = 250;
/** 오버레이 폭(글자 수 기준). 가장 긴 줄보다 넉넉하게 */
const BOX_WIDTH_CH = 88;

const f = (v: number | undefined, digits = 2) => (v === undefined || !Number.isFinite(v) ? "-" : v.toFixed(digits));
const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));

type Props = {
  audio: { debug(): GameAudioDebug };
  getWorld: () => World;
  derivation: WorldDerivation;
};

/** 브라우저가 WebGL에 쓰는 GPU 이름(소프트웨어 렌더링이면 llvmpipe·SwiftShader 등). 한 번만 읽는다. */
let gpuName: string | undefined;
function gpu() {
  if (gpuName !== undefined) return gpuName;
  try {
    const gl = document.createElement("canvas").getContext("webgl2") ?? document.createElement("canvas").getContext("webgl");
    const info = gl?.getExtension("WEBGL_debug_renderer_info");
    gpuName = gl ? String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER)) : "WebGL 없음";
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    gpuName = "알 수 없음";
  }
  return gpuName;
}

/** 렌더 루프 부하: 1초 동안의 프레임 수와 가장 긴 프레임 간격 */
function useFrameStats(enabled: boolean) {
  const stats = useRef({ fps: 0, worst: 0 });
  useEffect(() => {
    if (!enabled) return;
    let frame = 0, count = 0, worst = 0, last = performance.now(), windowStart = last;
    const tick = (now: number) => {
      count++;
      worst = Math.max(worst, now - last);
      last = now;
      if (now - windowStart >= 1000) {
        stats.current = { fps: (count * 1000) / (now - windowStart), worst };
        count = 0; worst = 0; windowStart = now;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [enabled]);
  return stats;
}

function describe(info: GameAudioDebug, world: World, derivation: WorldDerivation, frame: { fps: number; worst: number }) {
  const lines: string[] = [];
  lines.push(`이벤트 fallingstar ${info.frame?.meteors ? 1 : 0} (1 키) · rain ${world.weather === "rain" ? 1 : 0} (날씨)`);
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  lines.push(`렌더  ${f(frame.fps, 0)} fps · 최장 프레임 ${f(frame.worst, 0)} ms${memory ? ` · JS 힙 ${f(memory.usedJSHeapSize / 2 ** 20, 0)} MB` : ""}`);
  const q = renderQuality();
  lines.push(`품질 ${q.name} (배율 ${f(q.pixelRatio, 2)}/기기 ${f(window.devicePixelRatio || 1, 2)} · MSAA ${q.samples})`);
  lines.push(`GPU  ${gpu().slice(0, 70)}`);

  // 오디오
  const c = info.context;
  const byState = info.voices.reduce<Record<string, number>>((n, v) => ((n[v.state] = (n[v.state] ?? 0) + 1), n), {});
  const playing = info.placed.filter((p) => p.state === "playing").length;
  const slots = info.voices.length + playing;
  lines.push(c
    ? `오디오 ${c.state} · ${c.sampleRate} Hz · 지연(${c.latencyHint}) ${f(c.baseLatency * 1000, 1)}+${f((c.outputLatency ?? NaN) * 1000, 1)} ms · 비상관 ${info.diffuse ? "켬" : "끔"}`
    : "오디오 시작 전");
  lines.push(`Pd 슬롯 ${slots}개 = 사운드스케이프 ${info.voices.length} + 배치한 소리 ${playing}` +
    (info.voices.length ? ` (${Object.entries(byState).map(([s, n]) => `${s} ${n}`).join(", ")})` : ""));
  lines.push(`사운드스케이프 ${info.enabled ? (info.paused ? "일시정지" : "켜짐") : "꺼짐"}` +
    (info.soundscape ? ` · 등록 영역 ${info.soundscape.registered}개 · 반경 ${info.soundscape.options.radius} · 패닝 전환 ${info.soundscape.options.blend} · 최대 ${info.soundscape.options.max}` : ""));

  // 플레이어와 발밑 칸
  const p = info.frame;
  if (p) {
    const size = world.size, tx = Math.round(p.x), tz = Math.round(p.z);
    const inside = tx >= 0 && tz >= 0 && tx < size && tz < size;
    const index = tz * size + tx;
    const tile = inside ? world.terrain?.tiles[index] : undefined;
    const cell = inside ? derivation.environment.cells[index] : undefined;
    lines.push("");
    lines.push(`플레이어 격자 (${f(p.x)}, ${f(p.z)}) · 발 높이 ${f(p.y)} · yaw ${f((p.yaw * 180) / Math.PI, 0)}° · ${p.grounded ? "땅" : "공중"}${p.falling ? " · 낙하" : ""}`);
    lines.push(`칸 (${tx}, ${tz})${inside ? "" : " 맵 밖"}` + (tile
      ? ` · ${isHole(tile) ? "구멍" : tile.surface} · 높이 ${tile.height}`
      : ""));
    if (cell) {
      const wind = Math.hypot(cell.windX, cell.windZ);
      lines.push(`환경 물 ${cell.water === null ? "-" : f(cell.water)} · 풀 ${f(cell.grass)} · 안개 ${f(cell.fog)} · 바람 ${f(wind)} · 빛 ${f(cell.light)} · 습기 ${f(cell.moisture)}${cell.tree ? " · 나무" : ""}`);
    }
    const here = derivation.structures.filter((s) => Math.round(s.x) === tx && Math.round(s.z) === tz);
    if (here.length) lines.push(`구조물 ${here.map((s) => s.kind).join(", ")}`);
    lines.push(`whistle-player  footed grass ${f(p.grass)} · water ${f(p.water)} · speed ${f(info.speed)} 칸/초`);
  }

  // 실행 중인 패치 전체(Pd 엔진 슬롯): 상호작용 패치 + 사운드스케이프 패치(이번 프레임에 고른 영역 + 꺼지는 중인 영역)
  if (info.interaction.length || info.voices.length || info.placed.length) {
    lines.push("");
    // 한글은 폭이 두 칸이라 열이 어긋나므로 머리글은 영문(거리 d, 음량 gain, 폭 width, 농도 amount)
    lines.push(`${pad("patch", 20)}${pad("id / bus", 16)}${pad("kind", 8)}${pad("d", 6)}${pad("gain", 6)}${pad("width", 6)}${pad("amount", 7)}state`);
    for (const name of info.interaction) {
      const bus = name === "main" ? "mixdown 1–2" : `whistle-${name}`;
      lines.push(`${pad(name, 20)}${pad(bus, 16)}${pad("-", 8)}${pad("", 25)}${c?.state ?? "-"}`);
    }
    const near = info.soundscape?.near ?? [];
    const order = (id: string) => { const k = near.findIndex((n) => n.id === id); return k === -1 ? Infinity : k; };
    for (const voice of [...info.voices].sort((a, b) => order(a.id) - order(b.id) || (a.id < b.id ? -1 : 1))) {
      const n = near.find((r) => r.id === voice.id);
      const kind = n?.kind ?? info.soundscape?.kindOf(voice.id) ?? "?";
      const values = n
        ? `${pad(f(n.distance), 6)}${pad(f(n.gain), 6)}${pad(f(n.width), 6)}${pad(f(n.amount), 7)}`
        : pad("", 25);
      lines.push(`${pad(voice.patch, 20)}${pad(voice.id, 16)}${pad(kind, 8)}${values}${voice.state}`);
    }
    // 배치한 소리: 슬롯 이름(vK)과 거리·음량(width·amount 대신 pan·재생 방식)
    for (const p of info.placed)
      lines.push(`${pad("placed_sound", 20)}${pad(p.slot, 16)}${pad("sound", 8)}${pad(f(p.distance), 6)}${pad(f(p.gain), 6)}` +
        `${pad(f(p.pan), 6)}${pad(p.mode, 7)}${p.state}`);
  }
  return lines.join("\n");
}

export function DebugOverlay({ audio, getWorld, derivation }: Props) {
  const [visible, setVisible] = useState(() => new URLSearchParams(location.search).has("debug"));
  const [text, setText] = useState("");
  const frame = useFrameStats(visible);
  const latest = useRef({ audio, getWorld, derivation });
  latest.current = { audio, getWorld, derivation };

  useEffect(() => {
    const toggle = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && (event.target.isContentEditable || event.target.closest("input, textarea, select"))) return;
      if (event.code === TOGGLE_CODE && !event.repeat) setVisible((v) => !v);
    };
    window.addEventListener("keydown", toggle);
    return () => window.removeEventListener("keydown", toggle);
  }, []);

  useEffect(() => {
    if (!visible) return;
    const update = () => {
      const { audio, getWorld, derivation } = latest.current;
      setText(describe(audio.debug(), getWorld(), derivation, frame.current));
    };
    update();
    const timer = setInterval(update, REFRESH_MS);
    return () => clearInterval(timer);
  }, [visible, frame]);

  if (!visible) return null;
  return (
    <pre
      aria-hidden="true"
      style={{
        position: "absolute", top: "max(12px, env(safe-area-inset-top))", right: "max(12px, env(safe-area-inset-right))", zIndex: 50, margin: 0, padding: "8px 10px",
        // 폭 고정: 내용 길이(releasing 표시, 영역 수)에 따라 박스가 늘고 줄면 오른쪽 기준이라 글자 시작이 흔들린다.
        // 가장 긴 줄(슬롯 6개 모두 다른 상태 + 영역 표 한 줄)이 들어가는 폭. 화면이 좁으면 화면에 맞춘다.
        boxSizing: "border-box", width: `min(${BOX_WIDTH_CH}ch, calc(100% - 80px))`, overflow: "hidden", pointerEvents: "none",
        font: "14px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace", whiteSpace: "pre",
        color: "#e8f5e9", background: "rgba(0, 0, 0, 0.62)", borderRadius: 6,
      }}
    >
      {text}
    </pre>
  );
}
