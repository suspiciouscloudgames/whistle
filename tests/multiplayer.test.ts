import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { WebSocket } from "ws";
import { starterWorld } from "../lib/world.ts";
import { flatTerrain } from "../lib/terrain.ts";
import { RoomDocument } from "../lib/multiplayer/room.ts";
import { applyPatches, diffWorld, ROOM_PATH, type Paint, type ServerMessage } from "../lib/multiplayer/protocol.ts";
import { attachRooms } from "../server/rooms.ts";
import { remoteFrequency, soundPosition } from "../lib/audio/remote-audio.ts";
import { interactionSound } from "../lib/audio/multiplayer-interaction.ts";
import type { Peer } from "../lib/multiplayer/protocol.ts";

const world = () => { const w = starterWorld(); w.objects = []; w.terrain = flatTerrain(w.size); return w; };
const paint = (index: number, tool: Paint["tool"] = "surface", surface: Paint["surface"] = "plain"): Paint => ({ layer: "tiles", tool, surface, asset: "circle", erase: false, hole: true, cells: [{ index }] });

test("interaction count includes self once and only audible 3D peers; proximity is listener-specific", () => {
  const listener = { x: 0, y: 0, z: 0, size: 12, yaw: 0, grass: 0, rough: 0, water: 0, grounded: true, falling: false };
  const peer = (id: string, x: number): Peer => ({ id, color: "#3378cc", number: 1, mode: "play", active: true, cursor: null, frame: { ...listener, x } });
  const others = [peer("self", 0), peer("a", 4), peer("b", 6), peer("c", 7)];
  assert.deepEqual(interactionSound([], "self", listener), { players: 1, proximity: 0 });
  for (let count = 1; count <= 4; count++) assert.equal(interactionSound(others.slice(0, count), "self", listener).players, count);
  assert.equal(interactionSound(others, "self", listener).proximity, 0.5);
  assert.equal(interactionSound(others, "self", { ...listener, x: 7 }).proximity, 1);
  others[1].mode = "edit"; others[2].active = false; others[3].frame = null;
  assert.deepEqual(interactionSound(others, "self", listener), { players: 1, proximity: 0 });
});

test("concurrent material and height edits merge; duplicate operations and cumulative strokes apply once", () => {
  const room = new RoomDocument(world());
  room.edit("a", "1", "stroke", undefined, paint(0, "raise"));
  room.edit("a", "1", "stroke", undefined, paint(0, "raise"));
  room.edit("b", "1", "stroke", undefined, paint(0, "surface", "soft"));
  room.edit("a", "2", "stroke", undefined, { ...paint(0, "raise"), cells: [{ index: 0 }, { index: 1 }] });
  assert.equal(room.world.terrain!.tiles[0].height, 1);
  assert.equal(room.world.terrain!.tiles[1].height, 1);
  assert.equal(room.world.terrain!.tiles[0].surface, "soft");
  room.revert("a", "3", false);
  assert.equal(room.world.terrain!.tiles[0].height, 0);
  assert.equal(room.world.terrain!.tiles[0].surface, "soft");
});
test("partial undo and redo preserve other authors, including intervening writes with the same value", () => {
  const room = new RoomDocument(world());
  room.edit("a", "1", "stroke", undefined, { ...paint(0, "surface", "soft"), cells: [{ index: 0 }, { index: 1 }] });
  room.edit("b", "1", "one", undefined, paint(1, "surface", "rough"));
  room.edit("b", "2", "two", undefined, paint(1, "surface", "soft"));
  assert.equal(room.revert("a", "2", false).skipped, 1);
  assert.equal(room.world.terrain!.tiles[0].surface, "plain");
  assert.equal(room.world.terrain!.tiles[1].surface, "soft");
  room.edit("b", "3", "three", undefined, paint(0, "surface", "slick"));
  assert.equal(room.revert("a", "3", true).skipped, 1);
  assert.equal(room.world.terrain!.tiles[0].surface, "slick");
});
test("sequential own undo/redo restores the effective history; height bounds do not undo another user's edit", () => {
  const room = new RoomDocument(world());
  room.edit("a", "1", "one", undefined, paint(0, "raise"));
  room.edit("a", "2", "two", undefined, paint(0, "raise"));
  room.revert("a", "3", false); room.revert("a", "4", false);
  assert.equal(room.world.terrain!.tiles[0].height, 0);
  room.revert("a", "5", true); room.revert("a", "6", true);
  assert.equal(room.world.terrain!.tiles[0].height, 2);
  room.edit("b", "1", "one", undefined, paint(0, "raise"));
  assert.equal(room.revert("a", "7", false).skipped, 1);
  assert.equal(room.world.terrain!.tiles[0].height, 3);
});
test("hole commands are explicit, spawn is protected, and object placement conflicts never duplicate occupancy", () => {
  const room = new RoomDocument(world());
  room.edit("a", "1", "one", undefined, paint(0, "hole"));
  room.edit("b", "1", "one", undefined, paint(0, "hole"));
  assert.equal(room.world.terrain!.tiles[0].hole, true);
  const spawn = room.world.start.z * room.world.size + room.world.start.x;
  assert.equal(room.edit("a", "2", "two", undefined, paint(spawn, "hole")).skipped, 1);
  const symbol = { ...paint(1), layer: "symbols" as const };
  room.edit("a", "3", "three", undefined, symbol);
  assert.equal(room.edit("b", "2", "two", undefined, symbol).skipped, 1);
  assert.equal(room.world.objects.length, 1);
  assert.equal(room.edit("b", "3", "three", undefined, { ...symbol, erase: true }).skipped, 1);
});
test("stale metadata and whole-world replacement cannot overwrite shared state", () => {
  const base = world(), room = new RoomDocument(base);
  const next = structuredClone(base); next.weather = "rain";
  room.edit("a", "1", "one", diffWorld(base, next));
  const stale = structuredClone(base); stale.weather = "snow";
  assert.equal(room.edit("b", "1", "one", diffWorld(base, stale)).skipped, 1);
  assert.equal(room.world.weather, "rain");
  next.terrain!.seed++;
  assert.throws(() => diffWorld(base, next));
});
test("remote sound uses world scale and material values without a speed parameter", () => {
  const frame = { x: 0, y: 2, z: 0, size: 12, yaw: 0, grass: 0, rough: 0, water: 0, grounded: true, falling: false };
  assert.deepEqual(soundPosition(frame), { x: -11, y: 2.7, z: -11 });
  assert.ok(Math.abs(remoteFrequency({ ...frame, water: 1 }) - remoteFrequency(frame) - 110) < 1e-9);
  assert.ok(Math.abs(remoteFrequency({ ...frame, rough: 1 }) - remoteFrequency(frame) - 440) < 1e-9);
});

test("network paths cannot alias tile fields, while asset IDs retain their palette order", () => {
  const base = world();
  assert.throws(() => applyPatches(base, [{ key: "height:00", value: 3 }]));
  assert.throws(() => applyPatches(base, [{ key: "height:0:extra", value: 3 }]));
  base.assets[0].id = "custom:one";
  const next = applyPatches(base, [{ key: "asset:custom:one", value: { ...base.assets[0], name: "updated" } }]);
  assert.deepEqual(next.assets.map(a => a.id), base.assets.map(a => a.id));
  assert.equal(next.assets[0].name, "updated");
});

test("real room sockets share edits, assign distinct colors, gate 3D state, and announce departures", async () => {
  const server = createServer(); const closeRooms = attachRooms(server);
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const port = (server.address() as import("node:net").AddressInfo).port;
  const sockets: WebSocket[] = [];
  const inbox = (socket: WebSocket) => {
    const messages: ServerMessage[] = [];
    socket.on("message", raw => messages.push(JSON.parse(raw.toString())));
    return async (predicate: (m: ServerMessage) => boolean) => {
      for (let i = 0; i < 200; i++) {
        const at = messages.findIndex(predicate);
        if (at >= 0) return messages.splice(at, 1)[0];
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      throw Error("Expected room message did not arrive");
    };
  };
  try {
    const a = new WebSocket(`ws://127.0.0.1:${port}${ROOM_PATH}`); sockets.push(a); const getA = inbox(a); await once(a, "open");
    a.send(JSON.stringify({ type: "join", room: "test-room-123456", world: world() }));
    const aw = await getA(m => m.type === "welcome"); assert.equal(aw.type, "welcome"); if (aw.type !== "welcome") return;
    const b = new WebSocket(`ws://127.0.0.1:${port}${ROOM_PATH}`); sockets.push(b); const getB = inbox(b); await once(b, "open");
    b.send(JSON.stringify({ type: "join", room: "test-room-123456" }));
    const bw = await getB(m => m.type === "welcome"); if (bw.type !== "welcome") throw Error("join");
    assert.equal(new Set(bw.peers.map(p => p.color)).size, 2);
    a.send(JSON.stringify({ type: "edit", id: "first", group: "stroke", paint: paint(0, "raise") }));
    const update = await getB(m => m.type === "world");
    assert.equal(update.type, "world"); if (update.type === "world") { assert.equal(update.author, aw.self); assert.equal(update.canUndo, false); }
    a.send(JSON.stringify({ type: "presence", mode: "play", active: true, cursor: null }));
    await getB(m => m.type === "peer" && m.peer.id === aw.self && m.peer.mode === "play");
    const frame = { x: 2, y: 0, z: 2, size: 12, yaw: 0, grass: 1, rough: 0, water: 0, grounded: true, falling: false };
    a.send(JSON.stringify({ type: "frame", revision: 1, frame }));
    await getB(m => m.type === "peer" && m.peer.id === aw.self && m.peer.frame?.grass === 1);
    a.send(JSON.stringify({ type: "presence", mode: "edit", active: true, cursor: 5 }));
    await getB(m => m.type === "peer" && m.peer.id === aw.self && m.peer.cursor === 5 && m.peer.frame === null);
    a.close(); await getB(m => m.type === "left" && m.id === aw.self);
  } finally {
    for (const socket of sockets) socket.terminate();
    closeRooms(); await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
