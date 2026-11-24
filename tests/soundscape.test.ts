import assert from "node:assert/strict";
import { test } from "node:test";
import { createSoundscape, toListenerSpace, type SoundscapeEvent } from "../lib/audio/soundscape.ts";

// --- 최소한의 가짜 Web Audio: 램프를 시간에 따라 실제처럼 보간한다 ---
class FakeParam {
  events: { time: number; value: number; ramp: boolean }[] = [];
  clock: { currentTime: number };
  initial: number;
  constructor(clock: { currentTime: number }, initial = 0) { this.clock = clock; this.initial = initial; }
  get value() {
    const now = this.clock.currentTime;
    let value = this.initial, time = 0;
    for (const event of this.events) {
      if (event.time <= now) { value = event.value; time = event.time; continue; }
      if (event.ramp) return value + (event.value - value) * (now - time) / (event.time - time);
      break;
    }
    return value;
  }
  set value(v: number) { this.initial = v; this.events = []; }
  cancelScheduledValues(time: number) { this.events = this.events.filter(e => e.time < time); }
  setValueAtTime(value: number, time: number) { this.events.push({ time, value, ramp: false }); }
  linearRampToValueAtTime(value: number, time: number) { this.events.push({ time, value, ramp: true }); }
  /** 테스트에서는 지수 접근 대신 그 시각에 바로 목표값이 되는 것으로 본다. */
  setTargetAtTime(value: number, time: number) { this.events.push({ time, value, ramp: false }); }
}
class FakeNode {
  outputs: FakeNode[] = [];
  disconnected = false;
  connect(node: FakeNode) { this.outputs.push(node); return node; }
  disconnect() { this.disconnected = true; this.outputs = []; }
}
function fakeContext() {
  const clock = { currentTime: 0 };
  const param = (v = 0) => new FakeParam(clock, v);
  type FakePanner = FakeNode & { positionX: FakeParam; positionY: FakeParam; positionZ: FakeParam; panningModel?: string };
  const created = { gains: [] as (FakeNode & { gain: FakeParam })[], panners: [] as FakePanner[], filters: [] as (FakeNode & { type?: string; frequency: FakeParam })[], mergers: [] as FakeNode[] };
  const listener = Object.fromEntries(
    ["positionX", "positionY", "positionZ", "forwardX", "forwardY", "forwardZ", "upX", "upY", "upZ"].map(k => [k, param()]),
  );
  const clocks: (FakeNode & { offset: FakeParam; stopAt: number; ended: boolean; onended: (() => void) | null })[] = [];
  /** 오디오 시계를 진행하고, 그때까지 끝난 예약 소스의 onended를 부른다. */
  const advance = (time: number) => {
    clock.currentTime = time;
    for (const c of clocks) if (!c.ended && c.stopAt <= time) { c.ended = true; c.onended?.(); }
  };
  const context = {
    get currentTime() { return clock.currentTime; },
    destination: new FakeNode(),
    listener,
    createConstantSource() {
      const node = Object.assign(new FakeNode(), {
        offset: param(1), stopAt: Infinity, ended: false, onended: null as (() => void) | null,
        start() {}, stop(time: number) { node.stopAt = time; },
      });
      clocks.push(node);
      return node;
    },
    createGain() {
      const node = Object.assign(new FakeNode(), { gain: param(1) });
      created.gains.push(node);
      return node;
    },
    createBiquadFilter() {
      const node = Object.assign(new FakeNode(), { frequency: param(350), Q: param(1) });
      created.filters.push(node);
      return node;
    },
    createChannelMerger() {
      const node = new FakeNode();
      created.mergers.push(node);
      return node;
    },
    createPanner() {
      const node = Object.assign(new FakeNode(), { positionX: param(), positionY: param(), positionZ: param() });
      created.panners.push(node);
      return node;
    },
  };
  return { context: context as unknown as BaseAudioContext, clock, created, listener, advance, clocks };
}
function fakePatches() {
  type Entry = { name: string; node: FakeNode; destroyed: boolean; sent: string[]; resolve: () => void; reject: (e: Error) => void };
  const started: Entry[] = [];
  /** 패치에 있는 수신 버스(이 밖의 버스로 보내면 startPatch처럼 throw) */
  const buses = new Set(["whistle-region"]);
  type Handle = { node: AudioNode; destroy(): void; send(bus: string, message: (string | number)[]): void };
  const start = (_context: BaseAudioContext, name: string) => new Promise<Handle>((resolve, reject) => {
    const entry: Entry = {
      name, node: new FakeNode(), destroyed: false, sent: [],
      resolve: () => resolve({
        node: entry.node as unknown as AudioNode,
        destroy: () => { entry.destroyed = true; },
        send(bus, message) {
          if (!buses.has(bus)) throw new Error(`Pd 수신 버스가 없습니다: ${bus}`);
          entry.sent.push(`${bus} ${message.join(" ")}`);
        },
      }),
      reject,
    };
    started.push(entry);
  });
  return { start, started };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
const origin = { x: 0, y: 0, z: 0 };

function setup(fade = 0.5, diffuse = false) {
  const audio = fakeContext();
  const patches = fakePatches();
  const events: SoundscapeEvent[] = [];
  const scape = createSoundscape({ context: audio.context, start: patches.start, fade, diffuse, onEvent: e => events.push(e) });
  return { ...audio, ...patches, events, scape, types: () => events.map(e => `${e.type}:${e.id}`) };
}

test("등록만으로는 패치를 로드하지 않는다", () => {
  const { scape, started } = setup();
  scape.set({ id: "a", patch: "terrain_clock", position: origin });
  assert.equal(started.length, 0);
  assert.deepEqual(scape.snapshot(), { sources: 1, voices: [] });
});

test("unchanged sources do not reschedule audio parameters or postpone fade completion", async () => {
  const { scape, started, created, clock } = setup(.5);
  const source = { id: "a", patch: "p", position: { x: 3, y: 1, z: -4 }, gain: .8, width: .5 };
  scape.set(source); scape.activate("a"); started[0].resolve(); await flush();
  const parameters = [...created.gains.map(node => node.gain), ...Object.values(created.panners[0]).filter(value => value instanceof FakeParam)] as FakeParam[];
  const scheduled = parameters.map(param => structuredClone(param.events));
  for (let i = 1; i <= 8; i++) {
    clock.currentTime = i * .08;
    scape.setListener({ ...origin }, { x: 0, y: 0, z: -1 });
    scape.set({ ...source, position: { ...source.position } });
  }
  assert.deepEqual(parameters.map(param => param.events), scheduled);
  assert.equal(created.gains[1].gain.value, .8);
  scape.set({ ...source, gain: .4, width: 1, position: { x: 5, y: 1, z: -4 } });
  clock.currentTime += .5;
  assert.equal(created.gains[1].gain.value, .4);
  assert.equal(created.panners[0].positionX.value, 5);
  assert.equal(created.gains[2].gain.value, 0);
  assert.equal(created.gains[3].gain.value, 1);
});

test("mutating a reused listener position still moves active sources", async () => {
  const { scape, started, created, clock } = setup();
  const position = { x: 1, y: 0, z: 0 }, forward = { x: 0, y: 0, z: -1 };
  scape.setListener(position, forward);
  scape.set({ id: "a", patch: "p", position: { x: 4, y: 0, z: 0 } });
  scape.activate("a"); started[0].resolve(); await flush();
  assert.equal(created.panners[0].positionX.value, 3);
  position.x = 2;
  scape.setListener(position, forward);
  clock.currentTime += .2;
  assert.equal(created.panners[0].positionX.value, 2);
  forward.x = 1; forward.z = 0;
  scape.setListener(position, forward);
  clock.currentTime += .2;
  assert.equal(created.panners[0].positionX.value, 0);
  assert.equal(created.panners[0].positionZ.value, -2);
});

test("activate: 패치 → 게인 → 패너 → 점 게인 → 마스터(+ 가운데 게인 → 마스터)로 연결하고 위치를 적용한 뒤 fade in", async () => {
  const { scape, started, created, clock } = setup(0.5);
  scape.set({ id: "a", patch: "terrain_clock", position: { x: 3, y: 1, z: -4 } });
  scape.activate("a");
  scape.activate("a"); // 로딩 중 중복 호출은 무시
  assert.equal(started.length, 1);
  started[0].resolve();
  await flush();
  const [master, gain, dry, wet] = created.gains;
  const [panner] = created.panners;
  assert.deepEqual(started[0].node.outputs, [gain]);
  assert.deepEqual(gain.outputs, [panner, wet]);
  assert.deepEqual(panner.outputs, [dry]);
  assert.deepEqual(dry.outputs, [master]);
  assert.deepEqual(wet.outputs, [master], "기본: 가운데 경로는 필터 없이 마스터로");
  assert.equal(created.filters.length + created.mergers.length, 0, "기본: 필터 없음");
  assert.equal(dry.gain.value, 1, "width 없음 = 패닝 경로만");
  assert.equal(wet.gain.value, 0);
  assert.equal(panner.panningModel, "equalpower", "기본값");
  assert.deepEqual([(panner.positionX as FakeParam).value, (panner.positionY as FakeParam).value, (panner.positionZ as FakeParam).value], [3, 1, -4]);
  assert.equal(gain.gain.value, 0);
  clock.currentTime = 0.25;
  assert.equal(gain.gain.value, 0.5, "fade 중간");
  clock.currentTime = 1;
  assert.equal(gain.gain.value, 1);
  assert.deepEqual(scape.snapshot().voices, [{ id: "a", patch: "terrain_clock", state: "active" }]);
});

test("deactivate: fade out 후 update()에서 오디오 시계 기준으로 정리한다", async () => {
  const { scape, started, created, clock, types } = setup(0.5);
  scape.set({ id: "a", patch: "p", position: origin });
  scape.activate("a");
  started[0].resolve();
  await flush();
  clock.currentTime = 1;
  scape.deactivate("a");
  const gain = created.gains[1];
  clock.currentTime = 1.25;
  assert.equal(gain.gain.value, 0.5);
  scape.update();
  assert.equal(started[0].destroyed, false, "fade 중에는 정리하지 않음");
  clock.currentTime = 1.5;
  scape.update();
  assert.equal(started[0].destroyed, true);
  assert.equal(gain.disconnected, true);
  assert.deepEqual(scape.snapshot().voices, []);
  assert.deepEqual(types(), ["loading:a", "active:a", "releasing:a", "released:a"]);
});

test("update()를 부르지 않아도 fade out이 끝나는 오디오 시각에 정리된다(onended)", async () => {
  const { scape, started, clocks, advance, types } = setup(0.5);
  scape.set({ id: "a", patch: "p", position: origin });
  scape.activate("a");
  started[0].resolve();
  await flush();
  advance(1);
  scape.deactivate("a");
  assert.equal(clocks.length, 1);
  assert.equal(clocks[0].stopAt, 1.5);
  assert.equal(clocks[0].offset.value, 0, "무음");
  advance(1.4);
  assert.equal(started[0].destroyed, false);
  advance(1.5);
  assert.equal(started[0].destroyed, true);
  assert.equal(clocks[0].disconnected, true);
  assert.deepEqual(types(), ["loading:a", "active:a", "releasing:a", "released:a"]);
});

test("다시 켠 뒤에 도착한 onended는 정리하지 않는다", async () => {
  const { scape, started, advance } = setup(0.5);
  scape.set({ id: "a", patch: "p", position: origin });
  scape.activate("a");
  started[0].resolve();
  await flush();
  advance(1);
  scape.deactivate("a");
  advance(1.2);
  scape.activate("a");
  advance(2);
  assert.equal(started[0].destroyed, false);
  assert.equal(scape.snapshot().voices[0].state, "active");
});

test("fade out 중에 다시 켜면 같은 노드로 현재 값에서 다시 올린다", async () => {
  const { scape, started, created, clock } = setup(0.5);
  scape.set({ id: "a", patch: "p", position: origin });
  scape.activate("a");
  started[0].resolve();
  await flush();
  clock.currentTime = 1;
  scape.deactivate("a");
  clock.currentTime = 1.25; // 0.5까지 내려옴
  scape.activate("a");
  const gain = created.gains[1];
  assert.equal(gain.gain.value, 0.5, "튀지 않고 현재 값에서 시작");
  clock.currentTime = 1.75;
  assert.equal(gain.gain.value, 1);
  scape.update();
  assert.equal(started.length, 1, "새로 로드하지 않음");
  assert.equal(started[0].destroyed, false);
});

test("로딩 중에 끄면 로드가 끝나는 즉시 정리하고 연결하지 않는다", async () => {
  const { scape, started, created } = setup();
  scape.set({ id: "a", patch: "p", position: origin });
  scape.activate("a");
  scape.deactivate("a");
  started[0].resolve();
  await flush();
  assert.equal(started[0].destroyed, true);
  assert.equal(created.gains.length, 1, "마스터 외에 게인을 만들지 않음");
  assert.deepEqual(scape.snapshot().voices, []);
});

test("로딩 중에 껐다가 다시 켜면 한 번만 로드해서 켠다", async () => {
  const { scape, started } = setup();
  scape.set({ id: "a", patch: "p", position: origin });
  scape.activate("a");
  scape.deactivate("a");
  scape.activate("a");
  started[0].resolve();
  await flush();
  assert.equal(started.length, 1);
  assert.equal(started[0].destroyed, false);
  assert.deepEqual(scape.snapshot().voices, [{ id: "a", patch: "p", state: "active" }]);
});

test("로드 실패는 error 이벤트로 알리고 다음 activate에서 다시 시도한다", async () => {
  const { scape, started, types } = setup();
  scape.set({ id: "a", patch: "p", position: origin });
  scape.activate("a");
  started[0].reject(new Error("fetch failed"));
  await flush();
  assert.deepEqual(scape.snapshot().voices, []);
  scape.activate("a");
  assert.equal(started.length, 2);
  assert.deepEqual(types(), ["loading:a", "error:a", "loading:a"]);
});

test("set: 위치는 짧게(0.1초) 미끄러지듯 옮기고, 패치가 바뀌면 끄고 다음 activate에서 새 패치를 로드한다", async () => {
  const { scape, started, created, clock } = setup(0.5);
  scape.set({ id: "a", patch: "p", position: origin });
  scape.activate("a");
  started[0].resolve();
  await flush();
  clock.currentTime = 1;
  scape.set({ id: "a", patch: "p", position: { x: 5, y: 0, z: 0 } });
  const x = created.panners[0].positionX as FakeParam;
  assert.equal(x.value, 0, "바로 뛰지 않는다");
  clock.currentTime = 1.05;
  assert.ok(Math.abs(x.value - 2.5) < 1e-9, "중간");
  clock.currentTime = 1.1;
  assert.equal(x.value, 5);
  scape.set({ id: "a", patch: "q", position: origin });
  assert.equal(scape.snapshot().voices[0].state, "releasing");
  scape.activate("a");
  assert.equal(started[0].destroyed, true, "이전 패치 정리");
  assert.equal(started[1].name, "q");
});

test("리스너는 원점에 고정하고, 소스를 리스너 기준 좌표로 옮긴다", async () => {
  const { scape, listener, started, created, clock } = setup();
  const values = () => Object.fromEntries(Object.entries(listener).map(([k, p]) => [k, (p as FakeParam).value]));
  const fixed = { positionX: 0, positionY: 0, positionZ: 0, forwardX: 0, forwardY: 0, forwardZ: -1, upX: 0, upY: 1, upZ: 0 };
  assert.deepEqual(values(), fixed);
  scape.set({ id: "a", patch: "p", position: { x: 5, y: 1, z: 3 } });
  scape.activate("a");
  started[0].resolve();
  await flush();
  const panner = created.panners[0];
  const at = () => [panner.positionX, panner.positionY, panner.positionZ].map(p => +(p as FakeParam).value.toFixed(9));
  assert.deepEqual(at(), [5, 1, 3], "처음 연결할 때는 바로(미끄러지지 않음)");
  // 리스너가 (5, 0, 3)에서 +X를 보면 소스는 바로 위(앞뒤·좌우 0)
  clock.currentTime = 1;
  scape.setListener({ x: 5, y: 0, z: 3 }, { x: 1, y: 0, z: 0 });
  clock.currentTime = 1.1;
  assert.deepEqual(at(), [0, 1, 0]);
  assert.deepEqual(values(), fixed, "그래프의 리스너는 그대로");
});

test("toListenerSpace: 앞은 −Z, 오른쪽은 +X, 거리는 유지", () => {
  const close = (a: { x: number; y: number; z: number }, b: [number, number, number]) =>
    assert.ok(Math.abs(a.x - b[0]) < 1e-9 && Math.abs(a.y - b[1]) < 1e-9 && Math.abs(a.z - b[2]) < 1e-9, JSON.stringify(a));
  const L = { x: 10, y: 2, z: -4 };
  // −Z를 볼 때는 평행이동만
  close(toListenerSpace({ x: 13, y: 3, z: -6 }, L, { x: 0, y: 0, z: -1 }), [3, 1, -2]);
  // +X를 볼 때: 앞(+X)에 있는 점은 −Z, 오른쪽(+Z)에 있는 점은 +X
  close(toListenerSpace({ x: 12, y: 2, z: -4 }, L, { x: 1, y: 0, z: 0 }), [0, 0, -2]);
  close(toListenerSpace({ x: 10, y: 2, z: -1 }, L, { x: 1, y: 0, z: 0 }), [3, 0, 0]);
  // 뒤를 볼 때(+Z): 왼쪽·오른쪽이 뒤집힌다
  close(toListenerSpace({ x: 13, y: 2, z: -4 }, L, { x: 0, y: 0, z: 1 }), [-3, 0, 0]);
  // 정규화하지 않은 방향도 같다
  close(toListenerSpace({ x: 12, y: 2, z: -4 }, L, { x: 7, y: 0, z: 0 }), [0, 0, -2]);
  // 거리 유지
  const p = { x: 4, y: -1, z: 7 }, local = toListenerSpace(p, L, { x: Math.sin(0.7), y: 0, z: -Math.cos(0.7) });
  assert.ok(Math.abs(Math.hypot(local.x, local.y, local.z) - Math.hypot(p.x - L.x, p.y - L.y, p.z - L.z)) < 1e-9);
});

test("dispose: 모든 패치를 정리하고 로딩 중인 것도 끝나면 정리한다", async () => {
  const { scape, started, created } = setup();
  scape.set({ id: "a", patch: "p", position: origin });
  scape.set({ id: "b", patch: "p", position: origin });
  scape.activate("a");
  started[0].resolve();
  await flush();
  scape.activate("b");
  scape.dispose();
  assert.equal(started[0].destroyed, true);
  started[1].resolve();
  await flush();
  assert.equal(started[1].destroyed, true);
  assert.equal(created.gains[0].disconnected, true, "마스터 연결 해제");
  scape.activate("a");
  assert.equal(started.length, 2, "dispose 후에는 아무것도 하지 않음");
});

test("등록되지 않은 소스를 켜면 오류", () => {
  const { scape } = setup();
  assert.throws(() => scape.activate("missing"), /등록되지 않은/);
});

test("AudioParam이 없는 리스너·패너(예전 브라우저)는 setPosition/setOrientation으로 설정한다", async () => {
  const calls: string[] = [];
  const clock = { currentTime: 0 };
  const context = {
    get currentTime() { return clock.currentTime; },
    destination: new FakeNode(),
    listener: {
      setPosition: (...a: number[]) => calls.push(`listener.setPosition ${a.join(",")}`),
      setOrientation: (...a: number[]) => calls.push(`listener.setOrientation ${a.join(",")}`),
    },
    createGain: () => Object.assign(new FakeNode(), { gain: new FakeParam(clock, 1) }),
    createPanner: () => Object.assign(new FakeNode(), {
      setPosition: (...a: number[]) => calls.push(`panner.setPosition ${a.join(",")}`),
    }),
    createBiquadFilter: () => Object.assign(new FakeNode(), { frequency: new FakeParam(clock), Q: new FakeParam(clock) }),
    createChannelMerger: () => new FakeNode(),
  } as unknown as BaseAudioContext;
  const { start, started } = fakePatches();
  const scape = createSoundscape({ context, start });
  scape.setListener({ x: 1, y: 2, z: 3 }, { x: 0, y: 0, z: -1 });
  scape.set({ id: "a", patch: "p", position: { x: -6, y: 0, z: 0 } });
  scape.activate("a");
  started[0].resolve();
  await flush();
  scape.set({ id: "a", patch: "p", position: { x: 4, y: 1, z: 2 } });
  // 리스너는 처음에 원점에 한 번 놓고, 소스는 리스너 (1, 2, 3) 기준 좌표로
  assert.deepEqual(calls, [
    "listener.setPosition 0,0,0",
    "listener.setOrientation 0,0,-1,0,1,0",
    "panner.setPosition -7,-2,-3",
    "panner.setPosition 3,-1,-1",
  ]);
  assert.equal(scape.snapshot().voices[0].state, "active");
});

test("width(기본): 필터 없이 패닝 경로와 가운데 경로를 직선으로 섞는다", async () => {
  const { scape, started, created, clock } = setup(0.5);
  scape.set({ id: "a", patch: "p", position: origin, width: 0.25 });
  scape.activate("a");
  started[0].resolve();
  await flush();
  const [, , dry, wet] = created.gains;
  assert.equal(dry.gain.value, 0.75);
  assert.equal(wet.gain.value, 0.25);
  clock.currentTime = 1;
  scape.set({ id: "a", patch: "p", position: origin, width: 1 });
  clock.currentTime = 1.01;
  assert.equal(dry.gain.value, 0, "외곽·안: 패닝 없이");
  assert.equal(wet.gain.value, 1, "좌우 모두 1");
});

/** 소스 하나의 경로를 연결에서 찾는다: 패치 → 게인 → [패너 → 점, 가운데, 확산] */
type Gain = FakeNode & { gain: FakeParam };
function paths(node: FakeNode) {
  const gain = node.outputs[0] as Gain;
  const [panner, wet, wetDiffuse] = gain.outputs as Gain[];
  return { dry: panner.outputs[0] as Gain, wet, wetDiffuse };
}

test("width(diffuse): 가운데 경로를 공유 확산 버스로 보내고 equal-power로 섞는다", async () => {
  const { scape, started, created, clock } = setup(0.5, true);
  scape.set({ id: "a", patch: "p", position: origin, width: 1 });
  scape.set({ id: "b", patch: "p", position: { x: 10, y: 0, z: 0 }, width: 0.5 });
  scape.activate("a");
  scape.activate("b");
  started.forEach(s => s.resolve());
  await flush();
  clock.currentTime = 0.01;
  const a = paths(started[0].node), b = paths(started[1].node);
  assert.equal(created.mergers.length, 1, "확산 버스는 하나");
  assert.equal(created.filters.length, 8, "좌우 all-pass 4개씩");
  assert.ok(created.filters.every(f => f.type === "allpass"));
  assert.equal(a.wetDiffuse.outputs[0], b.wetDiffuse.outputs[0], "두 소스가 같은 버스로");
  assert.ok(Math.abs(a.dry.gain.value) < 1e-9);
  assert.equal(a.wet.gain.value, 0, "필터 없는 가운데 경로는 쓰지 않음");
  assert.equal(a.wetDiffuse.gain.value, 1);
  assert.ok(Math.abs(b.dry.gain.value - Math.SQRT1_2) < 1e-9);
  assert.ok(Math.abs(b.wetDiffuse.gain.value - Math.SQRT1_2) < 1e-9);
});

test("setDiffuse: 실행 중에 켜고 끄면 경로 비율만 옮기고, 확산 버스는 처음 켤 때 한 번 만든다", async () => {
  const { scape, started, created, clock } = setup(0.5);
  scape.set({ id: "a", patch: "p", position: origin, width: 0.5 });
  scape.activate("a");
  started[0].resolve();
  await flush();
  assert.equal(created.filters.length, 0, "꺼져 있으면 필터를 만들지 않음");
  assert.equal(scape.diffuse(), false);
  clock.currentTime = 1;
  scape.setDiffuse(true);
  clock.currentTime = 1.01;
  const a = paths(started[0].node);
  assert.equal(created.filters.length, 8);
  assert.equal(a.wet.gain.value, 0);
  assert.ok(Math.abs(a.wetDiffuse.gain.value - Math.SQRT1_2) < 1e-9);
  assert.ok(Math.abs(a.dry.gain.value - Math.SQRT1_2) < 1e-9);
  clock.currentTime = 2;
  scape.setDiffuse(false);
  scape.setDiffuse(true);
  scape.setDiffuse(false);
  clock.currentTime = 2.01;
  assert.equal(created.filters.length, 8, "다시 켜도 새로 만들지 않음");
  assert.equal(a.wetDiffuse.gain.value, 0);
  assert.equal(a.wet.gain.value, 0.5);
  assert.equal(a.dry.gain.value, 0.5);
  // 꺼진 뒤 새로 켜진 소스도 확산 경로를 달아 둔다(다시 켤 때 바로 쓰도록), 값은 0
  scape.set({ id: "b", patch: "p", position: origin, width: 1 });
  scape.activate("b");
  started[1].resolve();
  await flush();
  assert.equal(paths(started[1].node).wetDiffuse.gain.value, 0);
});

test("messages: 연결 직후와 값이 바뀔 때만 패치로 보내고, 보내기에 실패한 버스는 건너뛴다", async () => {
  const { scape, started } = setup(0.5);
  const set = (amount: number) => scape.set({
    id: "a", patch: "p", position: origin, messages: { "whistle-region": [["amount", amount], ["distance", 0]], "whistle-missing": [[1]] },
  });
  set(0.5);
  scape.activate("a");
  started[0].resolve();
  await flush();
  set(0.5);
  set(0.2);
  set(0.2);
  assert.deepEqual(started[0].sent, [
    "whistle-region amount 0.5", "whistle-region distance 0", "whistle-region amount 0.2", "whistle-region distance 0",
  ]);
  assert.equal(scape.snapshot().voices[0].state, "active", "없는 버스 때문에 멈추지 않음");
});
