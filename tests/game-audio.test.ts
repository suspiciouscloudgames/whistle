import { test } from "node:test";
import assert from "node:assert/strict";
import { createGameAudio } from "../lib/audio/game-audio.ts";
import { editSound, playerSound } from "../lib/audio/game-parameters.ts";
import { createWorldDeriver } from "../lib/world-derivation.ts";
import { starterWorld } from "../lib/world.ts";
import { flatTerrain } from "../lib/terrain.ts";
import { interactionMessages, type InteractionSession, type PlayerSound } from "../lib/audio/pd-session.ts";
import { validateBoardHeight } from "../lib/audio/pd-session.ts";

test("board height accepts metres within the test range and rejects invalid measurements", () => {
  for (const height of [0, 0.1, 1.5, 10]) assert.equal(validateBoardHeight(height), height);
  for (const height of [-0.1, 10.01, NaN, Infinity, -Infinity]) {
    assert.throws(() => validateBoardHeight(height), /보드 높이/);
  }
});

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function session() {
  const edits: unknown[] = [], moves: PlayerSound[] = [], gates: boolean[] = [], events: unknown[] = [], whistles: number[][] = [];
  let closed = 0, stops = 0, suspends = 0, resumes = 0;
  return {
    edits, moves, gates, events, whistles, get closed() { return closed; }, get stops() { return stops; },
    get suspends() { return suspends; }, get resumes() { return resumes; },
    value: {
      context: { resume: async () => { resumes++; }, suspend: async () => { suspends++; } } as unknown as AudioContext,
      edit: (value: unknown) => edits.push(value),
      player: (value: PlayerSound) => moves.push(value),
      stopPlayer: () => { stops++; },
      event: (name: string, on: boolean) => events.push([name, on]),
      whistle: (gain: number, pan: number) => whistles.push([gain, pan]),
      mute: (value: boolean) => gates.push(value),
      close: async () => { closed++; },
    } as Pick<InteractionSession, "context" | "edit" | "player" | "stopPlayer" | "event" | "whistle" | "mute" | "close">,
  };
}
const sound = { x: 0.5, z: 0.5, overlap: 0 };
const moving: PlayerSound = { x: 0.5, y: 0, z: 0.5, grass: 1 };

test("edit parameters identify terrain combinations and ignore regenerated IDs in cumulative strokes", () => {
  const before = starterWorld();
  before.objects = [{ id: "old", asset: "circle", x: 0, z: 0, rotation: 0, scale: 1 }];
  before.terrain = flatTerrain(before.size);
  before.terrain.tiles[1].surface = "rough";
  const next = structuredClone(before);
  next.objects[0].id = "regenerated";
  const derive = createWorldDeriver();
  assert.equal(editSound(before, next, [0], derive(next)), null);
  next.objects.push({ id: "new", asset: "square", x: 1, z: 0, rotation: 0, scale: 1 });
  assert.deepEqual(editSound(before, next, [0, 1], derive(next)), {
    x: 1.5 / 12, z: 0.5 / 12, overlap: 1, asset: "square", action: "add", surface: "rough",
  });
  assert.equal(editSound(next, before, [1], derive(before))?.action, "remove");
});

test("player parameters preserve spatial state without a speed field", () => {
  const frame = { x: 0, y: 2.5, z: 11, size: 12, grass: 1, rough: 0, water: 0,
    grounded: true, falling: false, yaw: 1 };
  assert.equal(playerSound(frame).x, 0.5 / 12);
  assert.equal(playerSound(frame).z, 11.5 / 12);
  assert.equal(playerSound(frame).y, 2.5);
  assert.equal("speed" in playerSound(frame), false);
  assert.equal(playerSound({ ...frame, grounded: false }).grounded, false);
  assert.equal(playerSound({ ...frame, falling: true }).falling, true);
});

test("one session keeps only the latest edit during startup and cancels it on play/exit", async () => {
  const stub = session();
  let finish!: (value: typeof stub.value) => void, loads = 0;
  const audio = createGameAudio(() => { loads++; return new Promise((resolve) => { finish = resolve; }); }, (error) => assert.fail(String(error)));
  audio.edit(sound);
  audio.edit({ ...sound, overlap: 1 });
  finish(stub.value);
  await tick();
  assert.equal(loads, 1);
  assert.deepEqual(stub.edits, [{ ...sound, overlap: 1 }]);
  audio.play();
  audio.movement(moving);
  await tick();
  assert.deepEqual(stub.moves.at(-1), moving);
  const moveCount = stub.moves.length;
  audio.pause();
  audio.movement(moving);
  audio.event("fallingstar", true);
  assert.equal(stub.moves.length, moveCount);
  assert.equal(stub.stops, 2);
  assert.equal(stub.gates.at(-1), true);
  assert.equal(stub.events.length, 0);
  audio.resume();
  audio.stop();
  await tick();
  assert.equal(stub.gates.at(-1), true);
  audio.dispose();
  assert.equal(stub.closed, 1);
});

test("pending load cannot replay stale input after exiting or unmounting", async () => {
  for (const dispose of [false, true]) {
    const stub = session();
    let finish!: (value: typeof stub.value) => void;
    const audio = createGameAudio(() => new Promise((resolve) => { finish = resolve; }), (error) => assert.fail(String(error)));
    audio.edit(sound);
    audio.play();
    audio.movement(moving);
    if (dispose) audio.dispose(); else audio.stop();
    finish(stub.value);
    await tick();
    assert.equal(stub.edits.length, 0);
    assert.equal(stub.moves.length, 0);
    assert.deepEqual(stub.gates, dispose ? [] : [true]);
    assert.equal(stub.closed, Number(dispose));
  }
});

test("a failed load can be retried by the next real interaction", async () => {
  const stub = session(), failures: unknown[] = [];
  let attempt = 0;
  const audio = createGameAudio(async () => {
    if (++attempt === 1) throw new Error("offline");
    return stub.value;
  }, (error) => failures.push(error));
  audio.edit(sound);
  await tick();
  assert.equal(failures.length, 1);
  audio.edit({ ...sound, overlap: 1 });
  await tick();
  assert.equal(attempt, 2);
  assert.deepEqual(stub.edits, [{ ...sound, overlap: 1 }]);
  audio.dispose();
});

test("pause: 잠시 뒤 AudioContext를 멈추고(패치 처리 중단), 그 전에 다시 켜면 멈추지 않는다", async () => {
  const stub = session();
  const audio = createGameAudio(async () => stub.value, (error) => assert.fail(String(error)));
  audio.play();
  await tick();
  audio.pause();
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(stub.suspends, 1, "pause가 이어지면 suspend");
  const resumes = stub.resumes;
  audio.resume();
  await tick();
  assert.equal(stub.resumes, resumes + 1, "resume에서 AudioContext를 다시 켠다");
  audio.pause();
  audio.resume();
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(stub.suspends, 1, "곧바로 다시 켜면 suspend하지 않는다");
  audio.dispose();
});

test("a slow engine load after the tab is hidden also suspends audio processing", async () => {
  const stub=session();
  let finish!: (value:typeof stub.value)=>void;
  const audio=createGameAudio(()=>new Promise(resolve=>{finish=resolve;}),error=>assert.fail(String(error)));
  audio.play();audio.pause();
  await new Promise(resolve=>setTimeout(resolve,200));
  finish(stub.value);await tick();
  assert.equal(stub.gates.at(-1),true);
  await new Promise(resolve=>setTimeout(resolve,200));
  assert.equal(stub.suspends,1);
  audio.resume();await tick();
  assert.equal(stub.resumes,1);
  audio.dispose();
});

test("player state goes to Pd as four route-able messages", () => {
  const sent: string[] = [];
  const to = { send: (bus: string, message: (string | number)[]) => { sent.push(`${bus} ${message.join(" ")}`); } };
  interactionMessages({ edit: to, player: to, event: to }).player({
    x: 0.25, y: 1.5, z: 0.75, yaw: 2, crouch: true, run: false, grounded: true, falling: false, grass: 0.4, water: 1,
  });
  assert.deepEqual(sent, [
    "whistle-player position 0.25 1.5 0.75",
    "whistle-player yaw 2",
    "whistle-player stat 1 0 1 0",
    "whistle-player footed 0.4 1",
  ]);
});

test("events set while loading or paused reach Pd once the session runs; play/stop forget them", async () => {
  const stub = session();
  let finish!: (value: typeof stub.value) => void;
  const audio = createGameAudio(() => new Promise((resolve) => { finish = resolve; }), (error) => assert.fail(String(error)));
  audio.play();
  audio.event("rain", true);
  finish(stub.value);
  await tick();
  assert.deepEqual(stub.events, [["rain", true]], "엔진이 열리면 보낸다");
  audio.pause();
  audio.event("rain", false);
  assert.deepEqual(stub.events, [["rain", true], ["rain", false]], "일시정지 때 끄고 멈춘 동안은 보내지 않는다");
  audio.resume();
  await tick();
  assert.deepEqual(stub.events.at(-1), ["rain", false], "다시 켜면 마지막 값을 보낸다");
  audio.stop();
  audio.play();
  await tick();
  assert.equal(stub.events.length, 2, "새 플레이는 지난 값을 다시 보내지 않는다");
  audio.dispose();
});

test("player speed goes to Pd as a fifth message only when measured", () => {
  const sent: string[] = [];
  const to = { send: (bus: string, message: (string | number)[]) => { sent.push(`${bus} ${message.join(" ")}`); } };
  const messages = interactionMessages({ edit: to, player: to, event: to });
  messages.player({ x: 0.5, y: 0, z: 0.5, grass: 0, speed: 1.5 });
  assert.equal(sent.at(-1), "whistle-player speed 1.5");
  sent.length = 0;
  messages.player({ x: 0.5, y: 0, z: 0.5, grass: 0 });
  assert.equal(sent.length, 4);
});

test("game events go to Pd as whistle-event <name> 1/0", () => {
  const sent: string[] = [];
  const to = { send: (bus: string, message: (string | number)[]) => { sent.push(`${bus} ${message.join(" ")}`); } };
  const messages = interactionMessages({ edit: to, player: to, event: to });
  messages.event("fallingstar", true);
  messages.event("fallingstar", false);
  messages.event("rain", true);
  assert.deepEqual(sent, ["whistle-event fallingstar 1", "whistle-event fallingstar 0", "whistle-event rain 1"]);
});

test("rain and meteors stop before editing and unchanged frames do not resend events", async () => {
  const stub = session();
  const audio = createGameAudio(async () => stub.value, error => assert.fail(String(error)));
  audio.play(); await tick();
  for (let i = 0; i < 100; i++) {
    audio.event("rain", true);
    audio.event("fallingstar", true);
  }
  assert.deepEqual(stub.events, [["rain", true], ["fallingstar", true]]);
  audio.stop();
  audio.edit(sound); await tick();
  assert.deepEqual(stub.events.slice(-2), [["rain", false], ["fallingstar", false]]);
  audio.play(); await tick();
  audio.event("rain", true);
  assert.deepEqual(stub.events.at(-1), ["rain", true]);
  audio.dispose();
});

test("whistles play once and never survive pausing, exiting, or a pending load", async () => {
  const stub = session();
  let finish!: (value: typeof stub.value) => void;
  const audio = createGameAudio(() => new Promise(resolve => { finish = resolve; }), error => assert.fail(String(error)));
  audio.play(); audio.whistle(1, 0); audio.pause();
  finish(stub.value); await tick();
  audio.resume(); await tick();
  assert.deepEqual(stub.whistles, []);
  audio.whistle(.4, -.8);
  assert.deepEqual(stub.whistles, [[.4, -.8]]);
  audio.pause(); audio.whistle(1, 0); audio.resume(); await tick();
  audio.stop(); audio.whistle(1, 0); audio.play(); await tick();
  assert.deepEqual(stub.whistles, [[.4, -.8]]);
  audio.dispose();
});
