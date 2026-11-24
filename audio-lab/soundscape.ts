import { openEngine } from "../lib/audio/pd-runtime";
import { createSoundscape, type Soundscape } from "../lib/audio/soundscape";

const base = `${import.meta.env.BASE_URL}audio/`;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const start = $<HTMLButtonElement>("start");
const stop = $<HTMLButtonElement>("stop");
const status = $<HTMLParagraphElement>("status");
const controls = $<HTMLFieldSetElement>("controls");
const select = $<HTMLSelectElement>("patch");
const yawInput = $<HTMLInputElement>("yaw");
const canvas = $<HTMLCanvasElement>("map");
const list = $<HTMLTableSectionElement>("sources");
const meter = $<HTMLOutputElement>("meter");
const logBox = $<HTMLPreElement>("log");
const draw = canvas.getContext("2d")!;
/** 기본은 equalpower. ?panning=hrtf 로 HRTF와 비교할 수 있다. */
const panning: PanningModelType = new URLSearchParams(location.search).get("panning")?.toLowerCase() === "hrtf" ? "HRTF" : "equalpower";

/** 평면도 한 변이 나타내는 거리(m). 리스너는 가운데. */
const SPAN = 24;
const toMap = (v: number) => (v / SPAN + 0.5) * canvas.width;
const fromMap = (px: number) => (px / canvas.width - 0.5) * SPAN;

type Entry = { id: string; patch: string; x: number; z: number; on: boolean };
let context: AudioContext | undefined;
let scape: Soundscape | undefined;
let analysers: [AnalyserNode, AnalyserNode] | undefined;
let entries: Entry[] = [];
let nextId = 1;
let frame = 0;
const hold = [{ peak: 0, at: 0 }, { peak: 0, at: 0 }];

function log(message: string) {
  console.log(`[soundscape-lab] ${message}`);
  logBox.textContent = `${new Date().toLocaleTimeString()} ${message}\n${logBox.textContent}`;
}

const yaw = () => Number(yawInput.value) * Math.PI / 180;
/** yaw 0 = −Z(화면 위쪽), 양수 = 시계 방향(오른쪽으로 회전) */
const forward = () => ({ x: Math.sin(yaw()), y: 0, z: -Math.cos(yaw()) });

function stateOf(id: string) {
  return scape?.snapshot().voices.find((v) => v.id === id)?.state ?? "off";
}

function render() {
  const voices = scape?.snapshot().voices ?? [];
  status.textContent = context
    ? `AudioContext ${context.state} · ${context.sampleRate}Hz · ${panning} · 등록 ${entries.length}개 · 오디오 노드 ${voices.length}개`
    : "시작 전";
  list.replaceChildren(...entries.map((entry) => {
    const row = document.createElement("tr");
    for (const text of [entry.id, entry.patch, `${entry.x.toFixed(1)}, ${entry.z.toFixed(1)}`, stateOf(entry.id)]) {
      row.insertCell().textContent = text;
    }
    const cell = row.insertCell();
    const toggle = document.createElement("button");
    toggle.textContent = entry.on ? "끄기" : "켜기";
    toggle.onclick = () => setOn(entry, !entry.on);
    const remove = document.createElement("button");
    remove.textContent = "제거";
    remove.onclick = () => { scape?.remove(entry.id); entries = entries.filter((e) => e !== entry); log(`${entry.id} 제거`); render(); };
    cell.append(toggle, remove);
    return row;
  }));
}

function setOn(entry: Entry, on: boolean) {
  entry.on = on;
  if (on) scape?.activate(entry.id); else scape?.deactivate(entry.id);
  render();
}

function drawMap() {
  const { width, height } = canvas;
  draw.clearRect(0, 0, width, height);
  draw.strokeStyle = "#eee";
  for (let m = -SPAN / 2; m <= SPAN / 2; m += 2) {
    draw.beginPath(); draw.moveTo(toMap(m), 0); draw.lineTo(toMap(m), height); draw.stroke();
    draw.beginPath(); draw.moveTo(0, toMap(m)); draw.lineTo(width, toMap(m)); draw.stroke();
  }
  for (const entry of entries) {
    const state = stateOf(entry.id);
    draw.fillStyle = state === "active" ? "#2a7" : state === "off" ? "#bbb" : "#e90";
    draw.beginPath(); draw.arc(toMap(entry.x), toMap(entry.z), 7, 0, Math.PI * 2); draw.fill();
    draw.fillStyle = "#222";
    draw.fillText(entry.id, toMap(entry.x) + 9, toMap(entry.z) + 4);
  }
  // 리스너: 가운데, 바라보는 방향으로 삼각형
  const f = forward();
  const cx = toMap(0), cy = toMap(0);
  draw.fillStyle = "#c33";
  draw.beginPath();
  draw.moveTo(cx + f.x * 12, cy + f.z * 12);
  draw.lineTo(cx - f.z * 6 - f.x * 6, cy + f.x * 6 - f.z * 6);
  draw.lineTo(cx + f.z * 6 - f.x * 6, cy - f.x * 6 - f.z * 6);
  draw.fill();
}

function tick() {
  if (!analysers || !scape) return;
  scape.update();
  const now = performance.now();
  meter.textContent = analysers.map((analyser, channel) => {
    const data = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(data);
    let peak = 0;
    for (const value of data) peak = Math.max(peak, Math.abs(value));
    const held = hold[channel];
    if (peak >= held.peak || now - held.at > 1000) { held.peak = peak; held.at = now; }
    return `${channel ? "R" : "L"} ${held.peak.toFixed(4)}`;
  }).join(" · ");
  drawMap();
  frame = requestAnimationFrame(tick);
}

/** 평면도 좌표(m)에 패치를 놓고 켠다. 클릭과 테스트에서 함께 쓴다. */
function place(x: number, z: number) {
  if (!scape) return;
  const entry: Entry = { id: `s${nextId++}`, patch: select.value, on: true, x, z };
  entries.push(entry);
  scape.set({ id: entry.id, patch: entry.patch, position: { x, y: 0, z } });
  scape.activate(entry.id);
  render();
}

canvas.onclick = (event) => {
  const rect = canvas.getBoundingClientRect();
  const scale = canvas.width / rect.width;
  place(
    Math.round(fromMap((event.clientX - rect.left) * scale) * 2) / 2,
    Math.round(fromMap((event.clientY - rect.top) * scale) * 2) / 2,
  );
};

yawInput.oninput = () => scape?.setListener({ x: 0, y: 0, z: 0 }, forward());

start.onclick = async () => {
  start.disabled = true;
  try {
    const engine = await openEngine(base);
    context = engine.context;
    await context.resume();
    const ctx = context;
    const output = ctx.createGain();
    output.connect(ctx.destination);
    const splitter = new ChannelSplitterNode(ctx, { numberOfOutputs: 2 });
    analysers = [new AnalyserNode(ctx, { fftSize: 2048 }), new AnalyserNode(ctx, { fftSize: 2048 })];
    output.connect(splitter);
    splitter.connect(analysers[0], 0);
    splitter.connect(analysers[1], 1);
    scape = createSoundscape({
      context: ctx,
      destination: output,
      panning,
      start: (_c, name) => engine.start(name),
      onEvent: (event) => {
        log(event.type === "error"
          ? `${event.id} ${event.patch} 오류: ${event.error instanceof Error ? event.error.message : String(event.error)}`
          : `${event.id} ${event.patch} ${event.type}`);
        render();
      },
    });
    scape.setListener({ x: 0, y: 0, z: 0 }, forward());
    const patches = engine.files.filter((f) => f.endsWith(".pd") && !f.endsWith("-help.pd")).map((f) => f.slice(0, -3));
    select.replaceChildren(...patches.map((name) => new Option(name, name)));
    controls.disabled = false;
    stop.disabled = false;
    log(`시작: 패닝 ${panning}, 패치 ${patches.join(", ")}`);
    tick();
  } catch (error) {
    log(`시작 실패: ${error instanceof Error ? error.message : String(error)}`);
    start.disabled = false;
  }
  render();
};

stop.onclick = async () => {
  cancelAnimationFrame(frame);
  scape?.dispose();
  // 엔진(AudioContext)은 페이지당 하나라 닫지 않고 멈춘다. 다시 시작하면 같은 엔진을 쓴다.
  await context?.suspend();
  context = scape = analysers = undefined;
  entries = [];
  controls.disabled = true;
  stop.disabled = true;
  start.disabled = false;
  meter.textContent = "—";
  log("종료");
  drawMap();
  render();
};

drawMap();
