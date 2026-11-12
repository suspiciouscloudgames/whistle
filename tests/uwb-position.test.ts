import { test } from "node:test";
import assert from "node:assert/strict";
import { mapRoomPosition, roomPositionAt, sampleTrackedPosition, type RoomMapping } from "../lib/uwb-position.ts";
import { createWorldDeriver } from "../lib/world-derivation.ts";
import { createLabWorld } from "../uwb-lab/world.ts";
import { environmentAt } from "../lib/environment.ts";
import { floorHeight, terrainSample } from "../lib/terrain.ts";

const mapping: RoomMapping = { originX: 0, originZ: 0, width: 6, depth: 6, rotation: 0 };

test("room corners and centre map to grid edges and normalized Pd positions", () => {
  assert.deepEqual(mapRoomPosition({ x: 0, z: 0 }, mapping, 12), { x: -0.5, z: -0.5 });
  assert.deepEqual(mapRoomPosition({ x: 6, z: 6 }, mapping, 12), { x: 11.5, z: 11.5 });
  assert.deepEqual(mapRoomPosition({ x: 3, z: 3 }, mapping, 12), { x: 5.5, z: 5.5 });
  assert.deepEqual(mapRoomPosition({ x: 3, z: 3 }, mapping, 24), { x: 11.5, z: 11.5 });
  const world = createLabWorld();
  const value = sampleTrackedPosition(world, createWorldDeriver()(world), { x: 3, z: 3 }, mapping);
  assert.equal(value.sound?.x, 0.5);
  assert.equal(value.sound?.z, 0.5);
  assert.equal("speed" in value.sound!, false);
});

test("translated, rotated and non-square rooms use the configured axes", () => {
  const rotated = { originX: 10, originZ: -4, width: 8, depth: 4, rotation: 90 };
  const grid = mapRoomPosition({ x: 9, z: 0 }, rotated, 12)!;
  assert.ok(Math.abs(grid.x - 5.5) < 1e-10);
  assert.ok(Math.abs(grid.z - 2.5) < 1e-10);
  for (const rotation of [-135, 0, 36, 90, 180]) {
    const room = { ...rotated, rotation };
    const point = mapRoomPosition(roomPositionAt(1, 1, room), room, 12)!;
    assert.ok(Math.abs(point.x - 11.5) < 1e-8);
    assert.ok(Math.abs(point.z - 11.5) < 1e-8);
  }
});

test("out-of-bounds readings are rejected rather than pinned to the nearest edge", () => {
  for (const position of [{ x: -0.01, z: 2 }, { x: 6.01, z: 2 }, { x: 2, z: -1 }, { x: 2, z: 7 }]) {
    assert.equal(mapRoomPosition(position, mapping, 12), null);
  }
});

test("invalid coordinates and calibration never produce a Pd frame", () => {
  for (const x of [NaN, Infinity, -Infinity]) assert.throws(() => mapRoomPosition({ x, z: 1 }, mapping, 12));
  for (const key of Object.keys(mapping) as (keyof RoomMapping)[]) {
    assert.throws(() => mapRoomPosition({ x: 1, z: 1 }, { ...mapping, [key]: NaN }, 12));
  }
  for (const width of [0, -1]) assert.throws(() => mapRoomPosition({ x: 1, z: 1 }, { ...mapping, width }, 12));
});

test("tracking samples the existing terrain and environment without mutating the world", () => {
  const world = createLabWorld(), before = JSON.stringify(world);
  const derivation = createWorldDeriver()(world);
  for (const x of [1, 3, 5]) {
    const sample = sampleTrackedPosition(world, derivation, { x, z: 3 }, mapping);
    assert.equal(sample.status, "tracking");
    const frame = sample.frame!;
    const local = environmentAt(derivation.environment, frame.x, frame.z);
    const ground = floorHeight(world, frame.x, frame.z, derivation.structures)!;
    const wet = local.water !== null && ground < local.water;
    assert.equal(frame.y, ground);
    assert.equal(frame.grass, local.grass);
    assert.equal(frame.rough, wet ? 0 : terrainSample(world, frame.x, frame.z).weights.rough);
    assert.equal(frame.water, wet ? 1 : 0);
    assert.equal(frame.falling, false);
  }
  assert.ok(sampleTrackedPosition(world, derivation, { x: 1, z: 3 }, mapping).frame!.grass > 0);
  assert.equal(sampleTrackedPosition(world, derivation, { x: 3, z: 3 }, mapping).frame!.rough, 1);
  assert.equal(sampleTrackedPosition(world, derivation, { x: 5, z: 3 }, mapping).frame!.water, 1);
  assert.equal(JSON.stringify(world), before);
});

test("holes and positions outside the room have no audio input", () => {
  const world = createLabWorld();
  world.terrain!.tiles[6 * world.size + 6].hole = true;
  const derivation = createWorldDeriver()(world);
  const hole = sampleTrackedPosition(world, derivation, { x: 3.25, z: 3.25 }, mapping);
  assert.equal(hole.status, "no-ground");
  assert.equal(hole.sound, null);
  const outside = sampleTrackedPosition(world, derivation, { x: 7, z: 3 }, mapping);
  assert.equal(outside.status, "outside");
  assert.equal(outside.frame, null);
});
