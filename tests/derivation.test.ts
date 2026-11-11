import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createWorldDeriver, samePlacement } from "../lib/world-derivation.ts";
import { deriveStructures, floorHeight } from "../lib/terrain.ts";
import { deriveEnvironment } from "../lib/environment.ts";
import { createSimulation } from "../lib/world.ts";
import { terrainFixtures, terrainDigest, disposeTerrain } from "./terrain-fixtures.ts";
import { makeTerrain } from "../components/whistle/TerrainScene.ts";
import { placementChanges } from "../lib/placement-feedback.ts";

const baseline = JSON.parse(readFileSync(new URL("./fixtures/terrain-before.json", import.meta.url), "utf8"));
for (const name of Object.keys(terrainFixtures())) {
  test(`rendered terrain matches the pre-optimization geometry and materials: ${name}`, () => {
    const world = terrainFixtures()[name];
    const derivation = createWorldDeriver()(world);
    const terrain = makeTerrain(world, derivation.structures, derivation.environment);
    assert.strictEqual(terrain.environment, derivation.environment);
    assert.deepEqual(terrainDigest(terrain.group), baseline[name]);
    disposeTerrain(terrain.group);
  });
}

test("shared environment calculations preserve placement feedback through edits and undo", () => {
  let before = terrainFixtures().mixed;
  const derive = createWorldDeriver();
  for (const change of [
    (world: typeof before) => { world.terrain!.tiles[3 * 12 + 7].surface = "plain"; },
    (world: typeof before) => { world.terrain!.tiles[2 * 12 + 2].hole = true; },
    (world: typeof before) => { world.terrain!.tiles[5 * 12 + 7].height = 1; },
  ]) {
    const after = structuredClone(before);
    change(after);
    assert.deepEqual(placementChanges(before, after, derive(before), derive(after)), placementChanges(before, after));
    assert.deepEqual(placementChanges(after, before, derive(after), derive(before)), placementChanges(after, before));
    before = after;
  }
});

test("cloned worlds and unchanged actors reuse their derived environment", () => {
  const world = terrainFixtures().mixed;
  const derive = createWorldDeriver();
  const first = derive(world);
  assert.strictEqual(derive(structuredClone(world)), first);
  assert.strictEqual(derive(world, createSimulation(world).actors), first);
  world.title = "updated";
  world.weather = "snow";
  world.assets[0].image = "data:image/png;base64,AA==";
  assert.strictEqual(derive(world), first);
});

test("isolated symbols reuse terrain but bridges and canopies invalidate it", () => {
  const world = terrainFixtures().flat;
  const derive = createWorldDeriver();
  const initial = derive(world);
  const place = (x: number, z: number) => world.objects.push({
    id: `${x}:${z}`, asset: "circle", x, z, rotation: 0, scale: 1,
  });
  place(2, 8);
  assert.strictEqual(derive(world), initial);
  place(4, 8); place(2, 10); place(4, 10);
  const canopy = derive(world);
  assert.notStrictEqual(canopy, initial);
  assert.ok(canopy.structures.some((s) => s.kind === "canopy"));
  world.terrain!.tiles[8 * 12 + 3].hole = true;
  const bridge = derive(world);
  assert.ok(bridge.structures.some((s) => s.kind === "bridge"));
  const actors = createSimulation(world).actors;
  actors[0].removed = true;
  const removed = derive(world, actors);
  assert.notStrictEqual(removed, bridge);
  assert.deepEqual(removed.structures, deriveStructures(world, actors));
  assert.deepEqual(removed.environment, deriveEnvironment(world, removed.structures));
});

test("tile mutations, seed changes, and pattern toggles cannot reuse stale results", () => {
  const world = terrainFixtures().structures;
  const derive = createWorldDeriver();
  let previous = derive(world);
  for (const change of [
    () => { world.terrain!.tiles[0].height = 1; },
    () => { world.terrain!.tiles[1].surface = "slick"; },
    () => { world.terrain!.tiles[2].hole = true; },
    () => { world.terrain!.seed++; },
    () => { world.terrain!.patterns.canopy = false; },
  ]) {
    change();
    const next = derive(world);
    assert.notStrictEqual(next, previous);
    assert.deepEqual(next.structures, deriveStructures(world));
    assert.deepEqual(next.environment, deriveEnvironment(world, next.structures));
    previous = next;
  }
});

test("cache eviction and undo reproduce the same environment", () => {
  const original = terrainFixtures().mixed;
  const world = structuredClone(original);
  const derive = createWorldDeriver();
  const first = derive(world);
  for (let i = 0; i < 12; i++) {
    world.terrain!.seed++;
    derive(world);
  }
  const restored = derive(original);
  assert.notStrictEqual(restored, first);
  assert.deepEqual(restored, first);
});

test("unchanged paint ignores explicit false holes but preserves real changes", () => {
  const world = terrainFixtures().flat;
  const copy = structuredClone(world);
  copy.terrain!.tiles[0].hole = false;
  assert.equal(samePlacement(world, copy), true);
  copy.terrain!.tiles[0].height = 1;
  assert.equal(samePlacement(world, copy), false);
  copy.terrain!.tiles[0].height = 0;
  copy.terrain!.tiles[0].hole = true;
  assert.equal(samePlacement(world, copy), false);
  const changed = structuredClone(world);
  changed.objects.push({ id: "a", asset: "circle", x: 1, z: 1, rotation: 0, scale: 1 });
  assert.equal(samePlacement(world, changed), false);
});

test("cached structures preserve the walking surface across the whole board", () => {
  const world = terrainFixtures().structures;
  const cached = createWorldDeriver()(world);
  const direct = deriveStructures(world);
  for (let z = -.5; z < world.size; z += .25) for (let x = -.5; x < world.size; x += .25) {
    assert.equal(floorHeight(world, x, z, cached.structures), floorHeight(world, x, z, direct));
  }
});
