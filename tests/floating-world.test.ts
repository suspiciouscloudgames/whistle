import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createTerrainWorld } from "../lib/create-world.ts";
import { createMeetingRoom, addMeetingMember, meetingWorld } from "../lib/meeting.ts";
import { validateWorld } from "../lib/world.ts";
import { deriveStructures, floorHeight, terrainSample, flatTerrain } from "../lib/terrain.ts";
import { grassCoverAt } from "../components/whistle/Grass.ts";
import { blocksVoidStep, blocksWalkingStep } from "../lib/navigation.ts";
import { editTile, isVoid } from "../lib/tile.ts";
import { deriveEnvironment } from "../lib/environment.ts";
import { makeTerrain } from "../components/whistle/TerrainScene.ts";
import { disposeTerrain } from "./terrain-fixtures.ts";

test("new worlds have an isolated entrance and separated islands across seeds", () => {
  for (let seed = 0; seed < 128; seed++) {
    const world = createTerrainWorld(seed), remaining = new Set(world.terrain!.tiles.flatMap((t, i) => !isVoid(t) ? [i] : []));
    const groups: number[][] = [];
    while (remaining.size) {
      const first = remaining.values().next().value!, group = [first]; remaining.delete(first);
      for (let n = 0; n < group.length; n++) {
        const x = group[n] % world.size, z = Math.floor(group[n] / world.size);
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const xx = x + dx, zz = z + dz;
          if (xx >= 0 && zz >= 0 && xx < world.size && zz < world.size && remaining.delete(zz * world.size + xx)) group.push(zz * world.size + xx);
        }
      }
      groups.push(group);
    }
    assert.deepEqual(groups.map(g => g.length).sort(), [3, 3, 4, 4]);
    const entrance = groups.find(g => g.includes(world.start.z * world.size + world.start.x))!;
    assert.deepEqual(entrance.toSorted((a,b) => a-b), [
      (world.start.z-1)*world.size+world.start.x-1, (world.start.z-1)*world.size+world.start.x,
      world.start.z*world.size+world.start.x-1, world.start.z*world.size+world.start.x,
    ]);
    assert.equal(floorHeight(world, -2, 0, []), null);
    assert.deepEqual(validateWorld(JSON.parse(JSON.stringify(world))), world);
  }
});

test("edges block walking, jumping, diagonal shortcuts and long steps, while added paths and authored holes work", () => {
  const world = createTerrainWorld(5), from = {x:world.start.x,z:world.start.z-1}, tiles = world.terrain!.tiles;
  const to = { x: from.x, z: from.z - 1 }, index = to.z * world.size + to.x;
  assert.equal(blocksWalkingStep(world, from, to, []), true);
  assert.equal(blocksVoidStep(world, from, to), true);
  tiles[index] = editTile(tiles[index], "surface", "plain");
  assert.equal(blocksWalkingStep(world, from, to, []), false);
  tiles[index] = editTile(tiles[index], "hole", "plain");
  assert.equal(blocksWalkingStep(world, from, to, []), false);
  assert.equal(floorHeight(world, to.x, to.z, []), null);
  tiles[index] = editTile(tiles[index], "erase", "plain");
  const far = { x: from.x, z: from.z - 2 };
  tiles[far.z * world.size + far.x] = { height: 0, surface: "plain" };
  assert.equal(blocksVoidStep(world, from, far), true);
  const diagonal = { x: from.x + 1, z: from.z - 1 };
  tiles[diagonal.z * world.size + diagonal.x] = { height: 0, surface: "plain" };
  assert.equal(blocksVoidStep(world, from, diagonal), true);
  assert.equal(blocksVoidStep(world, { x: from.x, z: world.start.z + .4 }, { x: from.x, z: world.start.z + .45 }), true);
  assert.equal(blocksVoidStep(world, from, far, [{ kind: "bridge", ...to, height: 0, dx: 0, dz: 1, key: "test" }]), false);
});

test("walking and jumping stop at the rounded corner in solo and shared worlds", () => {
  const room = createMeetingRoom(13);
  addMeetingMember(room, "first");
  addMeetingMember(room, "second");
  for (const world of [createTerrainWorld(5), meetingWorld(room, "first")]) {
    const { x, z } = world.start;
    const inside = { x: x + .35, z: z + .35 };
    const outside = { x: x + .36, z: z + .36 };
    assert.notEqual(floorHeight(world, inside.x, inside.z, []), null);
    assert.equal(floorHeight(world, outside.x, outside.z, []), null);
    assert.equal(blocksWalkingStep(world, world.start, inside, []), false);
    assert.equal(blocksWalkingStep(world, inside, outside, []), true);
    assert.equal(blocksVoidStep(world, inside, outside), true);
  }
});

test("a hole rim cannot remove the floor from an adjacent ordinary tile", () => {
  const world = createTerrainWorld(5);
  world.terrain = flatTerrain(world.size);
  for (let seed = 0; seed < 16; seed++) {
    world.terrain.seed = seed;
    world.terrain.tiles[5 * world.size + 5].hole = true;
    for (const [x,z] of [[4.49,5], [5.51,5], [5,4.49], [5,5.51]])
      assert.notEqual(floorHeight(world, x, z, []), null);
    assert.equal(floorHeight(world, 5, 5, []), null);
  }
});

test("void is preserved in saves, excluded from environmental effects, and cannot be the start", () => {
  const world = createTerrainWorld(13);
  const env = deriveEnvironment(world);
  world.terrain!.tiles.forEach((tile, i) => {
    if (!isVoid(tile)) return;
    assert.equal(env.cells[i].water, null);
    assert.equal(env.cells[i].grass, 0);
    assert.equal(env.cells[i].lift, 0);
    assert.ok(!env.regions.some(r => r.cells.includes(i)));
    assert.equal(floorHeight(world, i % world.size, Math.floor(i / world.size), []), null);
  });
  const saved = structuredClone(world);
  saved.terrain!.tiles[saved.start.z * saved.size + saved.start.x].void = true;
  assert.throws(() => validateWorld(saved));
});

test("floating ground renders only supported islands without a distant floor or deep walls", () => {
  const world = createTerrainWorld(17), terrain = makeTerrain(world, deriveStructures(world));
  try {
    assert.equal(terrain.group.getObjectByName("distant-ground"), undefined);
    assert.equal(terrain.group.getObjectByName("hole-bottom"), undefined);
    terrain.group.updateMatrixWorld(true);
    const ground = terrain.group.getObjectByName("continuous-ground")!;
    const ray = new THREE.Raycaster();
    for (let z = 0; z < world.size; z++) for (let x = 0; x < world.size; x++) {
      ray.set(new THREE.Vector3(x * 2 - world.size + 1, 20, z * 2 - world.size + 1), new THREE.Vector3(0, -1, 0));
      assert.equal(ray.intersectObject(ground).length > 0, !world.terrain!.tiles[z * world.size + x].void);
    }
    const bank = terrain.group.getObjectByName("terrain-bank") as THREE.Mesh;
    bank.geometry.computeBoundingBox();
    assert.ok(bank.geometry.boundingBox!.min.y > -2);
  } finally { disposeTerrain(terrain.group); }
});

test("adjacent floating grass tiles form one meadow without bare grid seams and retain rounded void edges", () => {
  const world = createTerrainWorld(17);
  world.terrain = flatTerrain(world.size); world.terrain.floating = true;
  world.terrain.tiles = world.terrain.tiles.map(() => ({ height: 0, surface: "plain", void: true }));
  for (let z=3;z<=5;z++) for (let x=3;x<=5;x++) world.terrain.tiles[z*world.size+x] = { height: 0, surface: "soft" };
  const env = deriveEnvironment(world);
  for (const [x,z] of [[3.5,4],[4,3.5],[3.5,3.5],[4.5,4.5]]) {
    assert.equal(terrainSample(world,x,z).coverage,1);
    assert.ok(grassCoverAt(world,x,z,[],env)>.95);
    assert.notEqual(floorHeight(world,x,z,[]),null);
  }
  assert.ok(terrainSample(world,2.6,2.6).coverage<.5);
  assert.equal(floorHeight(world,2,4,[]),null);
});
