import { test } from "node:test";
import assert from "node:assert/strict";
import { createGameAudio } from "../lib/audio/game-audio.ts";
import { editSound, playerSound } from "../lib/audio/game-parameters.ts";
import { createWorldDeriver } from "../lib/world-derivation.ts";
import { starterWorld } from "../lib/world.ts";
import { flatTerrain } from "../lib/terrain.ts";
import type { PdSession, PlayerSound } from "../lib/audio/webpd-session.ts";
import { validateBoardHeight } from "../lib/audio/webpd-session.ts";

test("board height accepts metres within the test range and rejects invalid measurements", () => {
  for (const height of [0, 0.1, 1.5, 10]) assert.equal(validateBoardHeight(height), height);
  for (const height of [-0.1, 10.01, NaN, Infinity, -Infinity]) {
    assert.throws(() => validateBoardHeight(height), /보드 높이/);
  }
});

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function session() {
  const edits: unknown[] = [], moves: PlayerSound[] = [], gates: boolean[] = [], events: unknown[] = [];
  let closed = 0, stops = 0;
  return {
    edits, moves, gates, events, get closed() { return closed; }, get stops() { return stops; },
    value: {
      context: { resume: async () => {} } as AudioContext,
      edit: (value: unknown) => edits.push(value),
      player: (value: PlayerSound) => moves.push(value),
      stopPlayer: () => { stops++; },
      event: (...values: number[]) => events.push(values),
      mute: (value: boolean) => gates.push(value),
      close: async () => { closed++; },
    } as Pick<PdSession, "context" | "edit" | "player" | "stopPlayer" | "event" | "mute" | "close">,
  };
}
const sound = { x: 0.5, z: 0.5, overlap: 0 };
const moving: PlayerSound = { x: 0.5, y: 0, z: 0.5, grass: 1, rough: 0 };

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
  audio.event(440, 0.1, 0);
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
    assert.equal(stub.gates.length, 0);
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
