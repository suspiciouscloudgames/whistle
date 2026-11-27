import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createWorldDeriver, samePlacement } from "../lib/world-derivation.ts";
import { deriveStructures, floorHeight } from "../lib/terrain.ts";
import { deriveEnvironment } from "../lib/environment.ts";
import { createSimulation, validateWorld } from "../lib/world.ts";
import * as THREE from "three";
import { surfaceImageGeometry } from "../components/whistle/SurfaceImage.ts";
import { terrainFixtures, terrainDigest, disposeTerrain } from "./terrain-fixtures.ts";
import { makeTerrain } from "../components/whistle/TerrainScene.ts";
import { placementChanges } from "../lib/placement-feedback.ts";

const baseline = JSON.parse(readFileSync(new URL("./fixtures/terrain-abstract.json", import.meta.url), "utf8"));
test("surface images clip to real terrain, rotate UVs and resize without filling holes", () => {
  const world = terrainFixtures().flat;
  world.terrain!.tiles[5 * world.size + 5].hole = true;
  const terrain = makeTerrain(world, []);
  const ground = terrain.group.getObjectByName("continuous-ground") as THREE.Mesh;
  const placed = { id: "skin", asset: "circle", x: 5, z: 5, rotation: 0, scale: 3 };
  const geometry = surfaceImageGeometry(ground, world, placed);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  const ray = new THREE.Raycaster(new THREE.Vector3(-1, 20, -1), new THREE.Vector3(0, -1, 0));
  assert.equal(ray.intersectObject(mesh).length, 0);
  assert.ok(geometry.getAttribute("position").count > 0);
  const rotated = surfaceImageGeometry(ground, world, { ...placed, rotation: 90 });
  const smaller = surfaceImageGeometry(ground, world, { ...placed, scale: 1 });
  assert.ok(smaller.getAttribute("position").count < geometry.getAttribute("position").count);
  ray.set(new THREE.Vector3(.8, 20, -1), new THREE.Vector3(0, -1, 0));
  const before = ray.intersectObject(mesh)[0].uv!;
  mesh.geometry = rotated;
  const after = ray.intersectObject(mesh)[0].uv!;
  assert.ok(Math.abs(before.x - after.y) < .0001);
  assert.ok(Math.abs(before.y - (1 - after.x)) < .0001);
  for (const item of [geometry, rotated, smaller]) item.dispose();
  (mesh.material as THREE.Material).dispose();
  disposeTerrain(terrain.group);
});

test("placement and motion survive world validation and reject unknown modes", () => {
  const world = terrainFixtures().flat;
  world.assets[0].placement = "surface";
  world.assets[0].motion = "still";
  assert.deepEqual(validateWorld(JSON.parse(JSON.stringify(world))), world);
  world.assets[0].placement = "field";
  assert.deepEqual(validateWorld(JSON.parse(JSON.stringify(world))), world);
  for (const key of ["placement", "motion"] as const) {
    const invalid = JSON.parse(JSON.stringify(world));
    invalid.assets[0][key] = "unknown";
    assert.throws(() => validateWorld(invalid));
  }
});

for (const name of Object.keys(terrainFixtures())) {
  test(`rendered terrain matches the abstract geometry and materials: ${name}`, () => {
    const world = terrainFixtures()[name];
    const derivation = createWorldDeriver()(world);
    const terrain = makeTerrain(world, derivation.structures, derivation.environment);
    assert.strictEqual(terrain.environment, derivation.environment);
    assert.deepEqual(terrainDigest(terrain.group), baseline[name]);
    disposeTerrain(terrain.group);
  });
}

test("the compact overview keeps every grass tuft and stone at its play position", () => {
  const world = terrainFixtures().mixed, derivation = createWorldDeriver()(world);
  const full = makeTerrain(world, derivation.structures, derivation.environment);
  const preview = makeTerrain(world, derivation.structures, derivation.environment, undefined, true);
  const instances = (group: THREE.Group) => {
    const meshes: THREE.InstancedMesh[] = [];
    group.traverse(object => {
      if (object instanceof THREE.InstancedMesh && ["grass-tufts", "scattered-stones"].includes(object.name)) meshes.push(object);
    });
    return meshes;
  };
  try {
    const detailed = instances(full.group), compact = instances(preview.group);
    assert.deepEqual(compact.map(m => m.name), detailed.map(m => m.name));
    assert.ok(compact.some(m => m.name === "grass-tufts") && compact.some(m => m.name === "scattered-stones"));
    compact.forEach((mesh, i) => {
      assert.deepEqual(mesh.instanceMatrix.array, detailed[i].instanceMatrix.array);
      assert.deepEqual(mesh.instanceColor?.array, detailed[i].instanceColor?.array);
      assert.ok(mesh.geometry.index!.count < detailed[i].geometry.index!.count);
    });
  } finally { disposeTerrain(full.group); disposeTerrain(preview.group); }
});

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

test("sound placements do not generate structures or invalidate the terrain cache", () => {
  const world = terrainFixtures().flat;
  world.objects = [];
  const derive = createWorldDeriver(), initial = derive(world);
  world.assets.push({ id: "recording", name: "Sound", shape: "sphere", color: "#111111", solid: false,
    sound: { data: "data:audio/wav;base64,AAAA", duration: 1, radius: 4, volume: 1, mode: "loop" } });
  world.objects = [[3, 3], [5, 3], [3, 5], [5, 5]].map(([x, z], i) => ({ id: `sound${i}`, asset: "recording", x, z, scale: 1, rotation: 0 }));
  assert.strictEqual(derive(world), initial);
  assert.deepEqual(deriveStructures(world), initial.structures);
  delete world.assets.at(-1)!.sound;
  assert.notStrictEqual(derive(world), initial);
  assert.ok(derive(world).structures.some(structure => structure.kind === "canopy"));
});
