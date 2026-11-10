import test from "node:test";
import assert from "node:assert/strict";
import { starterWorld, clone, validateWorld } from "../lib/world.ts";
import {
  flatTerrain,
  deriveStructures,
  LEVEL,
  terrainSample,
} from "../lib/terrain.ts";
import { deriveEnvironment, environmentAt } from "../lib/environment.ts";
import { makeTerrain } from "../components/whistle/TerrainScene.ts";
import * as THREE from "three";
import { daylightAt } from "../lib/daylight.ts";
import {
  treeAppearance,
  grassAppearance,
  TREE_SPECIES,
} from "../lib/vegetation.ts";
import { makeTrees } from "../components/whistle/Trees.ts";
import {
  placementChanges,
  feedbackRegions,
} from "../lib/placement-feedback.ts";
function empty() {
  const w = starterWorld();
  w.objects = [];
  w.terrain = flatTerrain(w.size);
  return w;
}
test("vegetation keeps its seeded appearance after reloads and unrelated placement changes", () => {
  const w = empty();
  for (let z = 1; z < 10; z++)
    for (let x = 1; x < 11; x++)
      w.terrain!.tiles[z * w.size + x] = { height: 1, surface: "soft" };
  const env = deriveEnvironment(w);
  const profiles = env.trees.map((t) => treeAppearance(0, t.x, t.z));
  assert.equal(
    new Set(profiles.map((t) => t.species)).size,
    TREE_SPECIES.length,
  );
  const loaded = validateWorld(JSON.parse(JSON.stringify(w)));
  assert.deepEqual(
    deriveEnvironment(loaded).trees.map((t) => treeAppearance(0, t.x, t.z)),
    profiles,
  );
  loaded.terrain!.tiles[11 * 12 + 11] = { height: 2, surface: "rough" };
  for (const tree of deriveEnvironment(loaded).trees) {
    const original = env.trees.findIndex(
      (t) => t.x === tree.x && t.z === tree.z,
    );
    if (original >= 0)
      assert.deepEqual(treeAppearance(0, tree.x, tree.z), profiles[original]);
  }
  const colors = [];
  for (let z = 0; z < 12; z += 2)
    for (let x = 0; x < 12; x += 2) {
      const color = grassAppearance(0, x, z);
      colors.push(color);
      assert.deepEqual(grassAppearance(0, x, z), color);
      assert.ok([color.r, color.g, color.b].every((v) => v > 0 && v < 1));
      assert.ok(color.height >= 0.65 && color.height <= 1.45);
    }
  assert.ok(
    Math.max(...colors.map((c) => c.r)) - Math.min(...colors.map((c) => c.r)) >
      0.15,
  );
  const trees = makeTrees(w, env, { value: 0 });
  assert.equal(trees.children.length, 5); // Shared bark + one draw per leaf type.
  for (const child of trees.children) {
    const mesh = child as THREE.Mesh;
    assert.ok(
      Array.from(mesh.geometry.getAttribute("position").array).every(
        Number.isFinite,
      ),
    );
    if (mesh instanceof THREE.InstancedMesh) {
      assert.ok(Array.from(mesh.instanceMatrix.array).every(Number.isFinite));
      assert.ok(mesh.count <= env.trees.length * 2600);
      mesh.dispose();
    }
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  }
});
test("daylight uses the device's local clock with readable nighttime lighting", () => {
  const noon = daylightAt(new Date(2026, 10, 10, 12, 0, 0));
  const night = daylightAt(new Date(2026, 10, 10, 0, 0, 0));
  assert.equal(noon.hour, 12);
  assert.equal(noon.daylight, 1);
  assert.equal(night.daylight, 0);
  assert.equal(night.sun, 0);
  assert.ok(night.ambient > 0 && night.moon > 0);
  assert.ok(noon.sun > night.moon && noon.ambient > night.ambient);
  assert.equal(noon.moon, 0);
});
test("daily lighting is continuous at midnight and throughout sunrise and sunset", () => {
  const midnight = daylightAt(new Date(2026, 10, 10, 0, 0, 0));
  const before = daylightAt(new Date(2026, 10, 9, 23, 59, 59));
  assert.ok(Math.abs(midnight.sunX - before.sunX) < 0.01);
  let previous = midnight;
  for (let minute = 1; minute < 1440; minute++) {
    const current = daylightAt(new Date(2026, 10, 10, 0, minute));
    assert.ok(current.daylight >= 0 && current.daylight <= 1);
    assert.ok(Math.abs(current.daylight - previous.daylight) < 0.02);
    for (const value of Object.values(current))
      assert.ok(Number.isFinite(value));
    previous = current;
  }
  assert.ok(daylightAt(new Date(2026, 10, 10, 8)).sunX < 0);
  assert.ok(daylightAt(new Date(2026, 10, 10, 16)).sunX > 0);
});
test("local fog can follow night lighting without changing the generated environment", () => {
  const w = basin();
  const terrain = makeTerrain(w, deriveStructures(w));
  const original = JSON.stringify(terrain.environment);
  const night = new THREE.Color("#525c6b");
  terrain.update(1000, undefined, night);
  let count = 0;
  terrain.group.traverse((object) => {
    if (object.name !== "generated-fog") return;
    count++;
    assert.ok(
      (
        object as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
      ).material.color.equals(night),
    );
  });
  assert.ok(count > 0);
  assert.equal(JSON.stringify(terrain.environment), original);
});
function basin() {
  const w = empty();
  for (let z = 2; z <= 5; z++)
    for (let x = 2; x <= 5; x++)
      w.terrain!.tiles[z * w.size + x] = {
        height: x === 2 || x === 5 || z === 2 || z === 5 ? 1 : 0,
        surface: x === 2 || x === 5 || z === 2 || z === 5 ? "rough" : "slick",
      };
  return w;
}
test("second water tile immediately highlights both cells; removing it removes both results", () => {
  const before = empty(),
    i = 3 * before.size + 3;
  before.terrain!.tiles[i].surface = "slick";
  const after = clone(before);
  after.terrain!.tiles[i + 1].surface = "slick";
  const filling = placementChanges(before, after),
    draining = placementChanges(after, before);
  for (const index of [i, i + 1]) {
    assert.ok(filling.some((c) => c.index === index && c.result && !c.removed));
    assert.ok(draining.some((c) => c.index === index && c.result && c.removed));
  }
  assert.deepEqual(placementChanges(after, clone(after)), []);
});
test("third soil tile highlights existing neighbors; broken groups and stairs react too", () => {
  const before = empty();
  const first = 3 * before.size + 3;
  before.terrain!.tiles[first].surface = "soft";
  before.terrain!.tiles[first + 1].surface = "soft";
  const after = clone(before);
  after.terrain!.tiles[first + 2].surface = "soft";
  assert.deepEqual(
    placementChanges(before, after)
      .filter((c) => c.result)
      .map((c) => c.index),
    [first, first + 1, first + 2],
  );
  assert.equal(
    placementChanges(after, before).filter((c) => c.removed).length,
    3,
  );
  const flat = empty(),
    raised = clone(flat);
  raised.terrain!.tiles[first].height = 1;
  const changes = placementChanges(flat, raised);
  for (const stair of deriveStructures(raised).filter(
    (s) => s.kind === "stairs",
  ))
    assert.ok(
      changes.some(
        (c) => c.index === stair.z * raised.size + stair.x && c.result,
      ),
    );
});
test("preview pulses group connected outcomes without wrapping board rows", () => {
  const cells = [3, 4, 5].map((index) => ({
    index,
    result: true,
    removed: false,
  }));
  const regions = feedbackRegions(cells, 4);
  assert.equal(regions.length, 2);
  assert.deepEqual(regions[0].indices, [4, 5]);
  assert.equal(regions[0].x, 0.5);
});
test("grass requires three orthogonally connected soil tiles and disappears when disconnected", () => {
  const w = empty();
  for (const [x, z] of [
    [3, 3],
    [4, 3],
  ])
    w.terrain!.tiles[z * w.size + x].surface = "soft";
  assert.equal(deriveEnvironment(w).cells.filter((c) => c.grass).length, 0);
  w.terrain!.tiles[4 * w.size + 5].surface = "soft"; // diagonal is not a connection
  assert.equal(deriveEnvironment(w).cells.filter((c) => c.grass).length, 0);
  w.terrain!.tiles[3 * w.size + 5].surface = "soft";
  assert.equal(deriveEnvironment(w).cells.filter((c) => c.grass).length, 4);
  w.terrain!.tiles[3 * w.size + 4].surface = "plain";
  assert.equal(deriveEnvironment(w).cells.filter((c) => c.grass).length, 0);
});
test("two adjacent water tiles form a pool on open ground, at edges, and at different heights", () => {
  for (const height of [0, 1, 3]) {
    const w = empty();
    w.terrain!.tiles[0] = { height, surface: "slick" };
    assert.equal(deriveEnvironment(w).ponds.length, 0);
    w.terrain!.tiles[1] = { height, surface: "slick" };
    assert.equal(deriveEnvironment(w).ponds.length, 1);
    assert.equal(deriveEnvironment(w).ponds[0].level, height * LEVEL - 0.06);
    w.terrain!.tiles[1].height = height === 3 ? 2 : height + 1;
    assert.equal(deriveEnvironment(w).ponds.length, 2);
    w.terrain!.tiles[1].height = -1;
    assert.equal(deriveEnvironment(w).ponds.length, 0);
  }
});
test("single or diagonal water tiles do not activate, enclosure is unnecessary", () => {
  const w = empty();
  w.terrain!.tiles[2 * w.size + 2].surface = "slick";
  w.terrain!.tiles[3 * w.size + 3].surface = "slick";
  assert.equal(deriveEnvironment(w).ponds.length, 0);
  w.terrain!.tiles[2 * w.size + 3].surface = "slick";
  assert.equal(deriveEnvironment(w).ponds[0].cells.length, 3);
});
test("water is inset into a carved bed with a dry bank, never a floating sheet", () => {
  const w = empty();
  const i = 4 * w.size + 4;
  w.terrain!.tiles[i] = { height: 2, surface: "slick" };
  w.terrain!.tiles[i + 1] = { height: 2, surface: "slick" };
  const env = deriveEnvironment(w),
    level = env.ponds[0].level;
  assert.ok(terrainSample(w, 4, 4).height < level);
  assert.ok(terrainSample(w, 4, 4.3).height > level);
  assert.equal(environmentAt(env, 4, 4.5).water, null);
  w.terrain!.tiles[i + 1].surface = "plain";
  assert.equal(terrainSample(w, 4, 4).height, 2 * LEVEL);
});
test("water mesh shore meets its terrain at both low and raised elevations", () => {
  for (const height of [0, 3]) {
    const w = empty(),
      i = 4 * w.size + 4;
    w.terrain!.tiles[i] = { height, surface: "slick" };
    w.terrain!.tiles[i + 1] = { height, surface: "slick" };
    const terrain = makeTerrain(w, deriveStructures(w));
    terrain.group.updateMatrixWorld(true);
    const water = terrain.group.getObjectByName(
      "generated-water",
    ) as THREE.Mesh;
    const position = water.geometry.getAttribute("position");
    const depth = water.geometry.getAttribute("waterDepth");
    const point = new THREE.Vector3();
    let shore = 0;
    for (let n = 0; n < depth.count; n++) {
      if (depth.getX(n) !== 0) continue;
      point.fromBufferAttribute(position, n).applyMatrix4(water.matrixWorld);
      const x = (point.x + w.size - 1) / 2,
        z = (point.z + w.size - 1) / 2;
      // Only boundary vertices referenced by the clipped mesh are shoreline.
      if (![...water.geometry.index!.array].includes(n)) continue;
      shore++;
      const ray = new THREE.Raycaster(
        new THREE.Vector3(point.x, 20, point.z),
        new THREE.Vector3(0, -1, 0),
      );
      const ground = ray.intersectObject(terrain.group.children[0], false)[0];
      assert.ok(ground && Math.abs(ground.point.y - point.y) < 0.015);
    }
    assert.ok(shore > 0);
    terrain.group.traverse((object) => {
      const mesh = object as THREE.Mesh;
      mesh.userData.dispose?.();
      mesh.geometry?.dispose();
      if (mesh.material)
        for (const m of Array.isArray(mesh.material)
          ? mesh.material
          : [mesh.material])
          m.dispose();
    });
  }
});
test("trees need a broad connected grove and a raised interior; editing recomputes the result", () => {
  const w = empty();
  for (let z = 3; z < 6; z++)
    for (let x = 3; x < 6; x++)
      w.terrain!.tiles[z * w.size + x].surface = "soft";
  assert.equal(deriveEnvironment(w).trees.length, 0);
  w.terrain!.tiles[4 * w.size + 4].height = 1;
  assert.equal(deriveEnvironment(w).trees.length, 1);
  w.terrain!.tiles[4 * w.size + 4].height = 0;
  assert.equal(deriveEnvironment(w).trees.length, 0);
});
test("an open three-cell corridor produces wind; a blocked end stops it", () => {
  const w = empty();
  for (let x = 3; x <= 5; x++)
    for (const z of [3, 5]) w.terrain!.tiles[z * w.size + x].height = 1;
  assert.ok(deriveEnvironment(w).cells[4 * w.size + 4].windX > 0.5);
  w.terrain!.tiles[4 * w.size + 2].height = 1;
  assert.equal(deriveEnvironment(w).cells[4 * w.size + 4].windX, 0);
});
test("fog requires moisture, shelter and low light; a dry open board has neither fog nor shade", () => {
  const flat = deriveEnvironment(empty());
  assert.ok(flat.cells.every((c) => c.fog === 0 && c.light === 1));
  const w = basin(),
    closed = deriveEnvironment(w),
    i = 3 * w.size + 3;
  assert.ok(closed.cells[i].light < 0.72);
  assert.ok(closed.cells[i].fog > 0);
  for (const tile of w.terrain!.tiles) tile.height = 0;
  const opened = deriveEnvironment(w);
  assert.equal(opened.cells[i].fog, 0);
  assert.equal(opened.cells[i].light, 1);
});
test("derived environments are deterministic, reversible and survive world serialization without extra stored state", () => {
  const w = basin(),
    before = clone(w),
    a = deriveEnvironment(w);
  assert.deepEqual(w, before);
  assert.deepEqual(
    deriveEnvironment(validateWorld(JSON.parse(JSON.stringify(w)))),
    a,
  );
  w.terrain!.tiles.forEach((t) => {
    if (t.surface === "slick") t.surface = "plain";
  });
  assert.equal(deriveEnvironment(w).ponds.length, 0);
  assert.deepEqual(deriveEnvironment(before), a);
  const s = environmentAt(a, 3.3, 3.7);
  assert.ok(Number.isFinite(s.light) && s.water !== null);
});
test("conditional geometry includes grounded water and fog, then removes water after tile removal", () => {
  const w = basin(),
    closed = makeTerrain(w, deriveStructures(w));
  assert.ok(closed.group.getObjectByName("generated-water"));
  assert.ok(closed.group.getObjectByName("generated-fog"));
  const water = closed.group.getObjectByName("generated-water") as THREE.Mesh;
  assert.ok(water.geometry.index!.count > 0);
  w.terrain!.tiles.forEach((t) => {
    if (t.surface === "slick") t.surface = "plain";
  });
  const opened = makeTerrain(w, deriveStructures(w));
  assert.equal(opened.group.getObjectByName("generated-water"), undefined);
  for (const result of [closed, opened])
    result.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) {
        assert.ok(
          [...m.geometry.getAttribute("position").array].every(Number.isFinite),
        );
        m.geometry.dispose();
      }
      if (m.material)
        for (const mat of Array.isArray(m.material)
          ? m.material
          : [m.material]) {
          (mat as THREE.MeshStandardMaterial).map?.dispose();
          mat.dispose();
        }
      if (o instanceof THREE.InstancedMesh) o.dispose();
    });
});

test("replacing connected water with soil removes the pool and generates grass", () => {
  const w = empty();
  const row = 4 * w.size + 4;
  for (let i = 0; i < 3; i++) w.terrain!.tiles[row + i].surface = "slick";
  const flooded = deriveEnvironment(w);
  assert.equal(flooded.ponds[0].cells.length, 3);
  assert.equal(flooded.cells.filter((c) => c.grass).length, 0);
  for (let i = 0; i < 3; i++) w.terrain!.tiles[row + i].surface = "soft";
  const planted = deriveEnvironment(w);
  assert.equal(planted.ponds.length, 0);
  assert.equal(planted.cells.filter((c) => c.grass).length, 3);
});
test("opening a wind corridor disperses local fog while the wet shaded ground stays", () => {
  const w = empty();
  for (let x = 3; x <= 5; x++) {
    for (const z of [3, 5]) w.terrain!.tiles[z * w.size + x].height = 2;
    w.terrain!.tiles[4 * w.size + x].surface = "slick";
  }
  const i = 4 * w.size + 4;
  w.terrain!.tiles[4 * w.size + 2].height = 1;
  const blocked = deriveEnvironment(w);
  assert.ok(blocked.cells[i].fog > 0);
  w.terrain!.tiles[4 * w.size + 2].height = 0;
  const open = deriveEnvironment(w);
  assert.ok(open.cells[i].windX > 0.5);
  assert.equal(open.cells[i].fog, 0);
  assert.ok(open.cells[i].moisture >= 0.8);
});

test("pond centers immerse half the player while banks remain walkable and jumping clears the water", async () => {
  const { floorHeight } = await import("../lib/terrain.ts");
  const { playerEyeHeight, blocksGroundStep } = await import("../lib/navigation.ts");
  const world = empty();
  for (let z = 4; z <= 6; z++) for (let x = 4; x <= 6; x++)
    world.terrain!.tiles[z * world.size + x] = { height: 0, surface: "slick" };
  const env = deriveEnvironment(world);
  const center = environmentAt(env, 5, 5).water!;
  const floor = floorHeight(world, 5, 5, [])!;
  assert.ok(center - floor >= 0.675);
  assert.ok(Math.abs(playerEyeHeight(floor, center) - center - .675) < 1e-8);
  assert.equal(playerEyeHeight(0, null), 1.35);
  assert.equal(playerEyeHeight(1, center), 2.35);
  assert.ok(playerEyeHeight(floor, center, .82) > center);
  let previous = floorHeight(world, 3, 5, [])!;
  for (let x = 3.01; x <= 5; x += .01) {
    const next = floorHeight(world, x, 5, [])!;
    assert.equal(blocksGroundStep(previous, next, .01), false);
    assert.equal(blocksGroundStep(next, previous, .01), false);
    previous = next;
  }
});

test("clouds occupy the sky above the board as well as the distance, without a circular empty center", async () => {
  const { cloudLayout } = await import("../lib/weather.ts");
  for (const size of [6, 12, 24]) {
    const clouds = cloudLayout(size);
    assert.deepEqual(clouds, cloudLayout(size));
    assert.ok(clouds.filter(c => Math.abs(c.x) < size && Math.abs(c.z) < size).length >= 4);
    assert.ok(clouds.some(c => Math.hypot(c.x, c.z) < size));
    assert.ok(clouds.some(c => Math.hypot(c.x, c.z) > size * 1.5));
    assert.ok(Math.max(...clouds.map(c => c.y)) - Math.min(...clouds.map(c => c.y)) > 10);
  }
});
