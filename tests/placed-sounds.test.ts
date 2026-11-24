import test from "node:test";
import { deriveEnvironment } from "../lib/environment.ts";
import assert from "node:assert/strict";
import { starterWorld, createSimulation, validateWorld } from "../lib/world.ts";
import { createPlacedSounds, nearbySounds } from "../lib/audio/placed-sounds.ts";
import { createPdSounds, wavFile, type PlaySound } from "../lib/audio/pd-sounds.ts";
import { validRecording, type Recording } from "../lib/audio/recording.ts";
import type { PlayerAudioFrame } from "../lib/audio/game-parameters.ts";

const sound: Recording = { data: "data:audio/wav;base64,AAAA", duration: 1, radius: 4, volume: 1, mode: "loop" };
const player: PlayerAudioFrame = { x: 6, y: 0, z: 6, size: 12, grass: 0, rough: 0, water: 0, grounded: true, falling: false, yaw: 0 };
function worldWithSounds(count = 1) {
  const world = starterWorld();
  world.assets.push({ id: "recording", name: "Sound", shape: "sphere", color: "#111111", solid: false, sound: { ...sound } });
  world.objects = Array.from({ length: count }, (_, i) => ({ id: `sound${i}`, asset: "recording", x: 6 + i % 5, z: 5 + Math.floor(i / 5), scale: 1, rotation: 0 }));
  return world;
}
/** 가짜 AudioContext와 가짜 play(Pd 슬롯 대신). plays: play 호출 수, active: 살아 있는 소리 수, end(): 재생 중인 소리가 끝났다고 알림 */
function contextProbe(deferred = false) {
  let plays = 0, active = 0;
  const sent: string[] = [];
  const waiting: (() => void)[] = [], ends: (() => void)[] = [];
  const param = () => ({ value: 0, setValueAtTime() {}, setTargetAtTime() {} });
  const node = () => ({ connect(next: unknown) { return next; }, disconnect() {} });
  const ctx = {
    currentTime: 2, state: "running", destination: {},
    createGain: () => ({ ...node(), gain: param() }),
    createStereoPanner: () => ({ ...node(), pan: param() }),
  } as unknown as AudioContext;
  const voice = () => {
    active++;
    return { id: `v${plays}`, node: node() as unknown as AudioNode, onEnd: (listener: () => void) => { ends.push(listener); },
      send: (message: (string | number)[]) => { sent.push(message.join(" ")); }, destroy() { active--; } };
  };
  const play: PlaySound = {
    prepare: () => Promise.resolve(),
    play: () => { plays++; return deferred ? new Promise(resolve => waiting.push(() => resolve(voice()))) : Promise.resolve(voice()); },
  };
  return { ctx, play, finish: () => waiting.splice(0).forEach(go => go()), finishOne: () => waiting.shift()?.(), end: () => ends.splice(0).forEach(go => go()), state: () => ({ plays, active }), sent };
}
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

test("recordings survive validation and reject URLs, malformed data, excessive duration and placement counts", () => {
  const world = worldWithSounds();
  assert.deepEqual(validateWorld(world).assets.at(-1)?.sound, sound);
  for (const change of [{ data: "https://example.com/audio.mp3" }, { data: "data:audio/wav;base64,AAAA!" }, { duration: 61 }, { radius: NaN }, { volume: 2 }])
    assert.equal(validRecording({ ...sound, ...change }), false);
  assert.throws(() => validateWorld(worldWithSounds(21)), /20개/);
  world.assets.at(-1)!.sound!.data = "data:audio/wav;base64,AAAA!";
  assert.throws(() => validateWorld(world), /사물 데이터/);
});

test("distance reduces volume and turning reverses left and right", () => {
  const world = worldWithSounds(); world.objects[0].x = 7; world.objects[0].z = 6;
  const actors = createSimulation(world).actors;
  const near = nearbySounds(world, actors, player)[0];
  const far = nearbySounds(world, actors, { ...player, x: 4 })[0];
  assert.ok(near.gain > far.gain);
  assert.equal(near.pan, 1);
  assert.equal(nearbySounds(world, actors, { ...player, yaw: Math.PI })[0].pan, -1);
  assert.equal(nearbySounds(world, actors, { ...player, x: 0 })[0].gain, 0);
});

test("only three nearby voices play and stop on exit", async () => {
  const world = worldWithSounds(5), actors = createSimulation(world).actors, probe = contextProbe();
  const audio = createPlacedSounds(probe.ctx, () => assert.fail("play failed"), {} as AudioNode, probe.play);
  audio.update(world, actors, player); await flush();
  assert.deepEqual(probe.state(), { plays: 3, active: 3 });
  audio.update(world, actors, { ...player, x: 0, z: 0 });
  assert.equal(probe.state().active, 0);
  audio.update(world, actors, player); await flush();
  assert.equal(probe.state().plays, 6);
  audio.stop(); assert.equal(probe.state().active, 0);
});

test("playing sounds get their distance and radius (tiles) each update", async () => {
  const world = worldWithSounds(), actors = createSimulation(world).actors, probe = contextProbe();
  const audio = createPlacedSounds(probe.ctx, () => assert.fail("play failed"), {} as AudioNode, probe.play);
  audio.update(world, actors, player); await flush();
  audio.update(world, actors, player);
  const [item] = audio.snapshot();
  const radius = nearbySounds(world, actors, player)[0].radius;
  assert.deepEqual(probe.sent, [`distance ${item.distance} ${radius}`, `distance ${item.distance} ${radius}`], "열 때 한 번, 다음 update에 한 번");
});

test("a slot that opens late cannot play after stopping", async () => {
  const world = worldWithSounds(), probe = contextProbe(true);
  const audio = createPlacedSounds(probe.ctx, () => assert.fail("play failed"), {} as AudioNode, probe.play);
  audio.update(world, createSimulation(world).actors, player);
  audio.stop(); probe.finish(); await flush();
  assert.equal(probe.state().active, 0);
});

test("approach clips play once (until the patch says it ended) and rearm only after leaving the radius", async () => {
  const world = worldWithSounds(); world.assets.at(-1)!.sound!.mode = "approach";
  const actors = createSimulation(world).actors, probe = contextProbe();
  const audio = createPlacedSounds(probe.ctx, () => assert.fail("play failed"), {} as AudioNode, probe.play);
  audio.update(world, actors, player); await flush();
  assert.equal(probe.state().active, 1);
  probe.end();
  assert.equal(probe.state().active, 0, "패치가 끝을 알리면 슬롯을 닫는다");
  audio.update(world, actors, player); await flush();
  assert.equal(probe.state().plays, 1);
  audio.update(world, actors, { ...player, x: 0, z: 0 });
  audio.update(world, actors, player); await flush();
  assert.equal(probe.state().plays, 2);
  audio.stop();
});

test("uploaded sounds become a 16-bit wav for Pd, stereo kept", () => {
  const wav = wavFile([new Float32Array([1, -1, 0.5]), new Float32Array([0, 0.5, -2])], 48000);
  const view = new DataView(wav.buffer);
  assert.equal(String.fromCharCode(...wav.slice(0, 4)), "RIFF");
  assert.equal(view.getUint16(22, true), 2, "스테레오");
  assert.equal(view.getUint32(24, true), 48000);
  assert.equal(view.getUint32(40, true), 12, "프레임 3개 × 2채널 × 2바이트");
  assert.deepEqual(Array.from({ length: 6 }, (_, i) => view.getInt16(44 + i * 2, true)), [32767, 0, -32767, 16384, 16384, -32767], "L R 번갈아");
  assert.equal(new DataView(wavFile([new Float32Array(4)], 44100).buffer).getUint16(22, true), 1, "모노는 모노");
});

test("20 stored sounds can exceed the old total byte cap, but a file cannot exceed 10 MB", () => {
  const world = worldWithSounds(20);
  const asset = world.assets.at(-1)!;
  for (let i = 1; i < 20; i++) world.assets.push({ ...asset, id: `recording${i}`, sound: { ...sound } });
  const data = "data:audio/wav;base64," + Buffer.alloc(1_000_000).toString("base64");
  for (const item of world.assets) if (item.sound) item.sound.data = data;
  assert.doesNotThrow(() => validateWorld(world));
  assert.equal(validRecording({ ...sound, data: "data:audio/wav;base64," + Buffer.alloc(10_000_000).toString("base64") }), true);
  assert.equal(validRecording({ ...sound, data: "data:audio/wav;base64," + Buffer.alloc(10_000_001).toString("base64") }), false);
});

test("terrain rules replace stored radii and change which recordings are audible", () => {
  const world = worldWithSounds(), actors = createSimulation(world).actors;
  world.assets.at(-1)!.sound!.radius = 8;
  const environment = deriveEnvironment(world);
  const source = world.objects[0], cell = environment.cells[source.z * world.size + source.x];
  const distant = { ...player, x: source.x - 5, z: source.z };
  assert.equal(nearbySounds(world, actors, distant, environment)[0].gain, 0);
  cell.water = 0;
  assert.ok(nearbySounds(world, actors, distant, environment)[0].gain > 0);
  cell.water = null;
  cell.grass = 1;
  const nearby = { ...player, x: source.x - 2.5, z: source.z };
  assert.ok(nearbySounds(world, actors, nearby, environment)[0].gain > 0);
  cell.tree = true;
  assert.equal(nearbySounds(world, actors, nearby, environment)[0].gain, 0);
  cell.tree = false; cell.grass = 0; cell.light = 0.3;
  assert.equal(nearbySounds(world, actors, nearby, environment)[0].gain, 0);
  delete world.assets.at(-1)!.sound!.radius;
  assert.doesNotThrow(() => validateWorld(world));
});

for (const kind of ["image", "text", "sound"] as const) {
  test(`${kind} limits count both saved assets and placements, including unplaced imports`, () => {
    const world = starterWorld();
    world.objects = [];
    const media = kind === "sound" ? { sound: { ...sound } }
      : { image: "data:image/png;base64,AAAA", ...(kind === "text" ? { text: "글" } : {}) };
    const asset = { id: "media", name: "1", shape: "sphere" as const, color: "#111111", solid: false, ...media };
    for (let i = 0; i < 20; i++) world.assets.push({ ...asset, id: `media${i}` });
    assert.doesNotThrow(() => validateWorld(world));
    world.assets.push(asset);
    assert.throws(() => validateWorld(world), /20개/);
    world.assets.pop();
    for (let i = 0; i < 21; i++) world.objects.push({ id: `placed${i}`, asset: "media0", x: i % 12, z: Math.floor(i / 12), scale: 1, rotation: 0 });
    assert.throws(() => validateWorld(world), /20개/);
    world.objects.pop();
    assert.doesNotThrow(() => validateWorld(world));
  });
}


test("obsolete loads cannot remove a restarted request or play a replaced recording", async () => {
  const world = worldWithSounds(), actors = createSimulation(world).actors, probe = contextProbe(true);
  const audio = createPlacedSounds(probe.ctx, () => assert.fail("play failed"), {} as AudioNode, probe.play);
  audio.update(world, actors, player);
  audio.stop();
  audio.update(world, actors, player);
  probe.finishOne(); await flush();
  audio.update(world, actors, player);
  assert.deepEqual(probe.state(), { plays: 2, active: 0 });
  world.assets.at(-1)!.sound = { ...sound, data: "data:audio/wav;base64,AAAB" };
  audio.update(world, actors, player);
  probe.finishOne(); await flush();
  assert.equal(probe.state().active, 0);
  probe.finishOne(); await flush();
  assert.deepEqual(probe.state(), { plays: 3, active: 1 });
  world.assets.at(-1)!.sound = { ...sound, data: "data:audio/wav;base64,AAAC" };
  audio.update(world, actors, player);
  assert.equal(probe.state().active, 0);
  probe.finish(); await flush();
  assert.equal(probe.state().active, 1);
  audio.stop();
});

test("distant recordings are not decoded or preloaded", async () => {
  const world = worldWithSounds(), probe = contextProbe();
  probe.play.prepare = () => assert.fail("distant sound was preloaded");
  const audio = createPlacedSounds(probe.ctx, () => assert.fail("play failed"), {} as AudioNode, probe.play);
  audio.update(world, createSimulation(world).actors, { ...player, x: 0, z: 0 });
  await flush();
  assert.deepEqual(probe.state(), { plays: 0, active: 0 });
});

function bankProbe(duration = 1, channels = 1) {
  const files = new Map<string, Uint8Array>(), messages: string[] = [];
  let decoded = 0, starts = 0, destroyed = 0;
  const engine = {
    context: { decodeAudioData: async () => {
      decoded++;
      return { duration, numberOfChannels: channels, length: 10, sampleRate: 10,
        getChannelData: () => new Float32Array(10) };
    } },
    writeFile: (path: string, data: Uint8Array) => { files.set(path, data); },
    removeFile: (path: string) => { files.delete(path); },
    send: (bus: string, values: unknown[], remember?: boolean) => { messages.push(`${bus} ${values.join(" ")} ${remember}`); },
    forget: (bus: string, values: unknown[]) => { messages.push(`forget ${bus} ${values.join(" ")}`); },
    start: async () => { starts++; return { id: `v${starts}`, node: {}, send() {}, onBang() {}, destroy() { destroyed++; } }; },
  } as unknown as Parameters<typeof createPdSounds>[0];
  return { engine, files, messages, state: () => ({ decoded, starts, destroyed }) };
}

test("Pd sound cache reuses decoding, protects playing sounds and evicts inactive arrays and files", async () => {
  const probe = bankProbe(), bank = createPdSounds(probe.engine, 208);
  const first = await bank.play(sound);
  await bank.prepare(sound);
  const second = await bank.play({ ...sound, data: "data:audio/wav;base64,AAAB" });
  assert.equal(probe.state().decoded, 2);
  await assert.rejects(bank.prepare({ ...sound, data: "data:audio/wav;base64,AAAC" }), /메모리/);
  assert.equal(probe.files.size, 2);
  first.destroy(); first.destroy();
  const third = await bank.play({ ...sound, data: "data:audio/wav;base64,AAAC" });
  assert.equal(probe.files.size, 2);
  assert.ok(!probe.files.has("uploads/sound1.wav"));
  assert.ok(probe.files.has("uploads/sound2.wav"));
  assert.ok(probe.messages.includes("sound1-L resize 0 false"));
  assert.ok(probe.messages.includes("sound1-R resize 0 false"));
  assert.ok(probe.messages.includes("forget whistle-sound-bank sound1"));
  second.destroy(); third.destroy();
  assert.equal(probe.state().destroyed, 3);
});

test("Pd sound decoding works without Uint8Array.fromBase64 and rejects unsupported decoded media", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(Uint8Array, "fromBase64");
  Object.defineProperty(Uint8Array, "fromBase64", { configurable: true, value: undefined });
  try {
    const probe = bankProbe();
    const voice = await createPdSounds(probe.engine).play(sound);
    assert.equal(probe.files.size, 1);
    voice.destroy();
  } finally {
    if (descriptor) Object.defineProperty(Uint8Array, "fromBase64", descriptor);
    else Reflect.deleteProperty(Uint8Array, "fromBase64");
  }
  for (const [duration, channels] of [[61, 1], [0, 1], [NaN, 1], [1, 3]]) {
    const probe = bankProbe(duration, channels);
    await assert.rejects(createPdSounds(probe.engine).play(sound), /지원 범위/);
    assert.equal(probe.files.size, 0);
    assert.equal(probe.state().starts, 0);
  }
});
