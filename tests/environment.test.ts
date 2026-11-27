import test from "node:test";
import assert from "node:assert/strict";
import { starterWorld, clone, validateWorld } from "../lib/world.ts";
import { createTerrainWorld } from "../lib/create-world.ts";
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
test("starting terrain leaves room to build with three small, separate examples", () => {
  for (let seed = 0; seed < 32; seed++) {
    const world = createTerrainWorld(seed);
    const terrain = world.terrain!;
    const env = deriveEnvironment(world);
    assert.equal(terrain.tiles.filter(t => !t.void && t.surface === "plain" && t.height === 0 && !t.hole).length, 4);
    assert.equal(terrain.tiles.filter(t => t.void).length, 130);
    assert.equal(env.cells.filter(c => c.grass > 0).length, 4);
    assert.equal(env.ponds.length, 1);
    assert.equal(env.ponds[0].cells.length, 3);
    assert.equal(env.trees.length, 0);
    assert.equal(deriveStructures(world).length, 0);
    assert.equal(world.objects.length, 0);
    for (const [dx, dz] of [[1, 0], [1, -1], [-2, 0], [-2, -1], [0, 1], [-1, 1], [0, -2], [-1, -2]])
      assert.equal(terrain.tiles[(world.start.z + dz) * world.size + world.start.x + dx].void, true);
    const loaded = validateWorld(JSON.parse(JSON.stringify(world)));
    assert.deepEqual(loaded.terrain, terrain);
  }
});
test("vegetation keeps its seeded appearance after reloads and unrelated placement changes", () => {
  const w = empty();
  for (let z = 1; z < 10; z++)
    for (let x = 1; x < 11; x++)
      w.terrain!.tiles[z * w.size + x] = { height: 1, surface: "soft" };
  const env = deriveEnvironment(w);
  const profiles = env.trees.map((t) => treeAppearance(0, t.x, t.z));
  assert.ok(new Set(profiles.map(t => t.bark.color)).size > 1);
  const barkTones = profiles.map(t => parseInt(t.bark.color.slice(1, 3), 16) / 255);
  assert.ok(Math.min(...barkTones) <= .25 && Math.max(...barkTones) >= .95);
  assert.equal(new Set(profiles.map(t => t.bark.texture)).size, 3);
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
  assert.equal(trees.children.length, 5);
  assert.ok(trees.children.every(child=>(child as THREE.Mesh).castShadow));
  assert.equal(trees.getObjectByName("tree-shadow-crowns"), undefined);
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
test("water cluster changes highlight neighbors while an isolated tile retains water", () => {
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
test("one and two soil tiles grow small plants, three make dense connected grass", () => {
  const w = empty(), i = 3 * w.size + 3;
  w.terrain!.tiles[i].surface = "soft";
  const single = deriveEnvironment(w).cells[i].grass;
  w.terrain!.tiles[i + 1].surface = "soft";
  const pair = deriveEnvironment(w).cells[i].grass;
  w.terrain!.tiles[i + 2].surface = "soft";
  const dense = deriveEnvironment(w).cells[i].grass;
  assert.ok(single > 0 && single < pair && pair < dense);
  assert.equal(dense, 1);
  w.terrain!.tiles[i + 1].surface = "plain";
  assert.equal(deriveEnvironment(w).cells[i].grass, single);
});
test("single water tiles work at each elevation and connected levels stay horizontal", () => {
  for (const height of [-1, 0, 1, 3, 6]) {
    const w = empty();
    w.terrain!.tiles[0] = { height, surface: "slick", hole: false };
    assert.equal(deriveEnvironment(w).ponds.length, 1);
    w.terrain!.tiles[1] = { height, surface: "slick", hole: false };
    assert.ok(deriveEnvironment(w).ponds[0].cells.includes(1));
    assert.equal(deriveEnvironment(w).ponds[0].level, Math.min(height, 0) * LEVEL - .06);
    w.terrain!.tiles[1].height = height + 1;
    assert.equal(deriveEnvironment(w).ponds.length, 1);
    assert.equal(deriveEnvironment(w).ponds[0].level, Math.min(height + 1, 0) * LEVEL - .06);
    w.terrain!.tiles[1].hole = true;
    assert.ok(deriveEnvironment(w).ponds[0].cells.includes(0));
    assert.ok(!deriveEnvironment(w).ponds[0].cells.includes(1));
  }
});
test("diagonal water tiles remain separate until an orthogonal connection is added", () => {
  const w = empty();
  w.terrain!.tiles[2 * w.size + 2].surface = "slick";
  w.terrain!.tiles[3 * w.size + 3].surface = "slick";
  assert.equal(deriveEnvironment(w).ponds.length, 2);
  w.terrain!.tiles[2 * w.size + 3].surface = "slick";
  assert.equal(deriveEnvironment(w).ponds[0].cells.length, 3);
});
test("water is inset into a carved bed with a dry bank, never a floating sheet", () => {
  const w = empty();
  const i = 4 * w.size + 4;
  w.terrain!.tiles[i] = { height: -1, surface: "slick", hole: false };
  w.terrain!.tiles[i + 1] = { height: -1, surface: "slick", hole: false };
  const env = deriveEnvironment(w),
    level = env.ponds[0].level;
  assert.ok(terrainSample(w, 4, 4).height < level);

  assert.ok(Array.from({ length: 80 }, (_, i) => 4 + i / 100).some(z =>
    environmentAt(env, 4, z).water === null && terrainSample(w, 4, z).height > level,
  ));
  assert.equal(environmentAt(env, 4, 5.2).water, null);
  w.terrain!.tiles[i + 1].surface = "plain";
  assert.ok(terrainSample(w, 4, 4).height < level);
  w.terrain!.tiles[i].surface = "plain";
  assert.equal(terrainSample(w, 4, 4).height, -LEVEL);
});
for (const compactOverview of [false, true]) test(`water mesh shore meets its terrain at zero and depressed elevations in ${compactOverview ? "preview" : "play"}`, () => {
  for (const [height, cellX, cellZ] of [[0, 4, 4], [-1, 4, 4], [0, 0, 0], [-1, 0, 0]]) {
    const w = empty(),
      i = cellZ * w.size + cellX;
    w.terrain!.tiles[i] = { height, surface: "slick", hole: false };
    w.terrain!.tiles[i + 1] = { height, surface: "slick", hole: false };
    const terrain = makeTerrain(w, deriveStructures(w), undefined, undefined, compactOverview);
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

      if (![...water.geometry.index!.array].includes(n)) continue;
      shore++;
      const ray = new THREE.Raycaster(
        new THREE.Vector3(point.x, 20, point.z),
        new THREE.Vector3(0, -1, 0),
      );
      const ground = ray.intersectObject(terrain.group.children[0], false)[0];
      assert.ok(ground && Math.abs(ground.point.y - point.y) < 0.015, `height=${height} shore=${x},${z} surface=${point.y} ground=${ground?.point.y}`);
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
test("trees grow in a six-cell flat grove and disappear when it shrinks below the threshold", () => {
  const w = empty();
  for (let z = 3; z < 5; z++)
    for (let x = 3; x < 6; x++)
      w.terrain!.tiles[z * w.size + x].surface = "soft";
  assert.ok(deriveEnvironment(w).trees.length > 0);
  w.terrain!.tiles[4 * w.size + 5].surface = "plain";
  assert.equal(deriveEnvironment(w).trees.length, 0);
});

test("a broad raised grove can grow more than sixteen smaller trees while retaining clear root spacing", () => {
  const world = empty();
  for (let z = 1; z < 11; z++) for (let x = 1; x < 11; x++)
    world.terrain!.tiles[z * world.size + x] = { height: 1, surface: "soft" };
  const env = deriveEnvironment(world);
  assert.ok(env.trees.length > 16 && env.trees.length <= 48);
  for (let i = 0; i < env.trees.length; i++) {
    const a = env.trees[i];
    assert.equal(a.height, terrainSample(world, a.x, a.z).height);
    for (const b of env.trees.slice(i + 1))
      assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= 1.4);
  }

  const tree = env.trees[0];
  const single = makeTrees(world, { ...env, trees: [tree] }, { value: 0 });
  single.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(single);
  assert.ok(bounds.max.y - tree.height < 5.5);
  assert.ok(bounds.min.y >= tree.height - .05);
  let leafCount = 0;
  for (const child of single.children)
    if (child instanceof THREE.InstancedMesh && child.name.startsWith("generated-leaves-")) leafCount += child.count;
  const profile=treeAppearance(world.terrain!.seed,tree.x,tree.z);
  assert.ok(leafCount < 1700);
  assert.equal(leafCount === 0,profile.foliage === "bare");
});

test("low shrubs have only branches while other trees retain seeded leaf-size and density variation", async () => {
  const {disposeTerrain}=await import("./terrain-fixtures.ts");
  const world=empty();world.terrain!.seed=89;
  world.terrain!.tiles.forEach(tile=>{tile.surface="soft";});
  const environment=deriveEnvironment(world);
  const candidates=Array.from({length:120},(_,i)=>{
    const x=i%12,z=Math.floor(i/12);
    return {x,z,profile:treeAppearance(89,x,z)};
  });
  const shrubs=candidates.filter(({profile})=>profile.growth === "shrub");
  assert.ok(shrubs.length>0);
  assert.ok(shrubs.every(({profile})=>profile.leafDensity === 0));
  const leafy=candidates.filter(({profile})=>profile.foliage !== "bare");
  assert.ok(Math.max(...leafy.map(c=>c.profile.leafSize))-Math.min(...leafy.map(c=>c.profile.leafSize))>.15);
  assert.ok(leafy.every(({profile})=>profile.leafSize<=.65));
  for(const foliage of ["bare","sparse","leafy"]){
    const candidate=candidates.find(({profile})=>profile.growth !== "shrub" && profile.foliage === foliage);
    assert.ok(candidate);
    const examples=foliage === "bare" ? [candidate,shrubs[0]] : [candidate];
    for(const {x,z,profile} of examples){
      const tree=makeTrees(world,{...environment,trees:[{x,z,height:terrainSample(world,x,z).height}]},{value:0});
      assert.ok(tree.getObjectByName("generated-trunks"));
      const leaves=tree.children.filter(child=>child.name.startsWith("generated-leaves-")) as THREE.InstancedMesh[];
      assert.equal(leaves.length === 0,foliage === "bare");
      assert.equal(tree.getObjectByName("tree-shadow-crowns"),undefined);
      for(const mesh of leaves){
        assert.equal(mesh.castShadow,true);
        assert.ok(mesh.customDepthMaterial instanceof THREE.MeshDepthMaterial);
        assert.equal(mesh.customDepthMaterial.onBeforeCompile,(mesh.material as THREE.Material).onBeforeCompile);
        const matrix=new THREE.Matrix4();
        for(let i=0;i<mesh.count;i++){
          mesh.getMatrixAt(i,matrix);
          const scale=new THREE.Vector3().setFromMatrixScale(matrix);
          assert.ok(scale.x<=1.3*profile.leafSize*profile.scale+1e-6);
        }
      }
      disposeTerrain(tree);
    }
  }
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

test("rectangular water placement has one connected interior and a curved, repeatable shoreline", () => {
  const world = empty();
  for (let z = 3; z <= 7; z++) for (let x = 3; x <= 8; x++)
    world.terrain!.tiles[z * world.size + x].surface = "slick";
  const env = deriveEnvironment(world);
  assert.equal(env.ponds.length, 1);
  for (let x = 3; x <= 8; x += .1)
    assert.notEqual(environmentAt(env, x, 5).water, null);
  const coastline = Array.from({ length: 36 }, (_, i) => {
    const x = 4 + i / 10;
    for (let z = 1.5; z < 4; z += .01)
      if (environmentAt(env, x, z).water !== null) return z;
    throw new Error("shore not found");
  });
  assert.ok(Math.max(...coastline) - Math.min(...coastline) > .15);
  assert.deepEqual(deriveEnvironment(clone(world)), env);
});

test("the visible landscape beyond the board matches walking height without a perimeter step", async () => {
  const { floorHeight } = await import("../lib/terrain.ts");
  const world = empty();
  for (let z = 4; z <= 9; z++) world.terrain!.tiles[z * world.size + 11].height = 2;
  const terrain = makeTerrain(world, []);
  terrain.group.updateMatrixWorld(true);
  const ground = terrain.group.getObjectByName("continuous-ground")!;
  const distant = terrain.group.getObjectByName("distant-ground")!;
  for (const x of [11.499, 11.501, 12, 12.9, 13.1, 14, 16, 19]) {
    const z = 6.2;
    const ray = new THREE.Raycaster(
      new THREE.Vector3(x * 2 - world.size + 1, 20, z * 2 - world.size + 1),
      new THREE.Vector3(0, -1, 0),
    );
    const hit = ray.intersectObjects([ground, distant], false)[0];
    assert.ok(hit);
    assert.ok(Math.abs(hit.point.y - floorHeight(world, x, z, [])!) < .04, `x=${x} mesh=${hit.point.y} floor=${floorHeight(world, x, z, [])}`);
  }
  assert.ok(Math.abs(floorHeight(world, 11.499, 6.2, [])! - floorHeight(world, 11.501, 6.2, [])!) < .001);
});

test("grass growth increases with connected area and saturates without losing ground cover", () => {
  const w=empty();
  for(const x of [3,4,5]) w.terrain!.tiles[3*w.size+x].surface="soft";
  const small=deriveEnvironment(w).cells[3*w.size+4];
  assert.equal(small.grass,1);assert.equal(small.growth,0);
  for(let z=2;z<8;z++) for(let x=2;x<8;x++) w.terrain!.tiles[z*w.size+x].surface="soft";
  const large=deriveEnvironment(w);
  assert.equal(large.cells[3*w.size+4].growth,1);
  assert.ok(large.cells.every(c=>c.growth>=0&&c.growth<=1));
});

test("water darkens only nearby low banks, and uses no per-pool reflection target", async () => {
  const {wetGround}=await import("../lib/environment-effects.ts");
  const w=empty();
  for(const x of [4,5]) w.terrain!.tiles[4*w.size+x].surface="slick";
  const env=deriveEnvironment(w);
  assert.ok(wetGround(env,4,4.65,0)>0);
  assert.equal(wetGround(env,4,4.65,2),0);
  assert.equal(wetGround(env,1,1,0),0);
  w.terrain!.tiles[5*w.size+4].height=2;
  assert.equal(deriveEnvironment(w).cells[5*w.size+4].moisture,0);
  const mesh=makeTerrain(w,[]).group.getObjectByName("generated-water") as THREE.Mesh<THREE.BufferGeometry,THREE.ShaderMaterial>;
  assert.equal("getRenderTarget" in mesh,false);
  assert.equal("tDiffuse" in mesh.material.uniforms,false);
});

test("water beside a hole keeps its surface without a falling water strip", () => {
  const w = empty();
  w.terrain!.tiles[4 * w.size + 4].surface = "slick";
  w.terrain!.tiles[4 * w.size + 5].height = -1;
  const terrain = makeTerrain(w, []);
  assert.ok(terrain.group.getObjectByName("generated-water"));
  assert.equal(terrain.group.getObjectByName("water-drain-flows"), undefined);
});

test("connected fog is grouped and capped instead of adding three meshes per tile", async () => {
  const {fogPatches}=await import("../lib/environment-effects.ts");
  const env=deriveEnvironment(empty());
  env.cells.forEach(c=>c.fog=.7);
  const patches=fogPatches(env);
  assert.ok(patches.length>0&&patches.length<=32);
  assert.ok(patches.every(p=>p.radius<3.1&&p.strength>0));
  env.cells.forEach(c=>c.fog=0);
  assert.deepEqual(fogPatches(env),[]);
});

test("relative terrain edits preserve material, clamp repeated edits and distinguish depressed ground from holes", async () => {
  const { editTile, isHole, MIN_HEIGHT, MAX_HEIGHT } = await import("../lib/tile.ts");
  let tile = { height: 0, surface: "rough" as const, hole: false };
  for (let i = 0; i < 50; i++) tile = editTile(tile, "raise", "plain") as typeof tile;
  assert.equal(tile.height, MAX_HEIGHT);
  assert.equal(tile.surface, "rough");
  for (let i = 0; i < 50; i++) tile = editTile(tile, "lower", "plain") as typeof tile;
  assert.equal(tile.height, MIN_HEIGHT);
  assert.equal(isHole(tile), false);
  const hole = editTile(tile, "hole", "plain");
  assert.equal(isHole(hole), true);
  assert.deepEqual(editTile(hole, "raise", "plain"), hole);
  assert.deepEqual(editTile(hole, "lower", "plain"), hole);
  assert.deepEqual(editTile(hole, "hole", "plain"), tile);
  assert.deepEqual(editTile(hole, "surface", "soft"), { height: -1, surface: "soft", hole: false });
  const legacy = {height: -1, surface: "plain" as const};
  assert.equal(isHole(legacy), true);
  assert.deepEqual(editTile(legacy, "surface", "soft"), {height: 0, surface: "soft", hole: false});
});

test("negative ground stays walkable and survives saves while old holes remain holes", async () => {
  const {floorHeight} = await import("../lib/terrain.ts");
  const w = empty();
  const index = w.start.z * w.size + w.start.x;
  w.terrain!.tiles[index] = {height: -1, surface: "plain", hole: false};
  w.terrain!.tiles[index+1] = {height: 1, surface: "plain", hole: false};
  w.terrain!.tiles[0] = {height: -1, surface: "plain"};
  w.terrain!.tiles[1] = {height: 6, surface: "plain"};
  const saved = validateWorld(JSON.parse(JSON.stringify(w)));
  assert.equal(floorHeight(saved, w.start.x, w.start.z), -LEVEL);
  assert.equal(floorHeight(saved, 0, 0), null);
  assert.equal(floorHeight(saved, 1, 0), 6 * LEVEL);
  assert.ok(deriveStructures(saved).some(s => s.kind === "stairs" && s.height === -1));
  for (const height of [-2, 7, 1.5, Infinity]) {
    const invalid = clone(saved);
    invalid.terrain!.tiles[1].height = height;
    assert.throws(() => validateWorld(invalid));
  }
  const invalid = clone(saved);
  (invalid.terrain!.tiles[1] as unknown as {hole: string}).hole = "false";
  assert.throws(() => validateWorld(invalid));
});

test("legacy grass density and movement remain while colors are neutral", async () => {
  const { stoneAppearance } = await import("../lib/stones.ts");
  const trees = Array.from({ length: 120 }, (_, i) => treeAppearance(89, i % 12, Math.floor(i / 12)));
  assert.ok(trees.some(t => t.growth === "shrub" && t.height < 1.8));
  assert.ok(trees.some(t => t.growth === "sapling" && t.height < 3.3));
  assert.ok(trees.some(t => t.height > 5 && t.trunkRadius < 0.15));
  const w = empty();
  w.terrain!.tiles.forEach(t => { t.surface = "soft"; });
  const terrain = makeTerrain(w, []);
  assert.equal(terrain.group.getObjectByName("scattered-stones"), undefined);
  assert.ok(terrain.group.getObjectByName("generated-trunks"));
  const ribbons = terrain.group.getObjectByName("grass-tufts") as THREE.InstancedMesh;
  assert.ok(ribbons.count > 50 && ribbons.count <= 4200);
  const matrix = new THREE.Matrix4(), scales: number[] = [];
  for (let i = 0; i < ribbons.count; i++) {
    ribbons.getMatrixAt(i, matrix);
    scales.push(new THREE.Vector3().setFromMatrixScale(matrix).x);
  }
  assert.ok(Math.min(...scales) < .95 && Math.max(...scales) > 1.15);
  const shader = { uniforms: {}, vertexShader: "#include <begin_vertex>", fragmentShader: "#include <color_fragment>\n#include <roughnessmap_fragment>" } as unknown as THREE.WebGLProgramParametersWithUniforms;
  (ribbons.material as THREE.Material).onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  terrain.update(2000);
  assert.equal(shader.uniforms.wind.value, 2);
  terrain.update(3000, undefined, undefined, true);
  assert.equal(shader.uniforms.grassMotion.value, 0);
  const first = stoneAppearance(89, 1.25, 3.1);
  assert.deepEqual(first, stoneAppearance(89, 1.25, 3.1));
});

test("effect feedback enters and leaves without replaying on region growth", async () => {
  const { initialEffectPresentation, updateEffectPresentation, finishEffectAnimation } = await import("../lib/effect-feedback.ts");
  const region = { kind: "wind", label: "바람", cells: [13, 14, 15], anchor: 14 };
  assert.equal(initialEffectPresentation([region]).markers[0].phase, "idle");
  let state = updateEffectPresentation(initialEffectPresentation([]), [region], 1000);
  const id = state.markers[0].id;
  assert.equal(state.markers[0].phase, "enter");
  assert.equal(state.markers[0].until, 1360);
  state = finishEffectAnimation(state, id);
  state = updateEffectPresentation(state, [{ ...region, cells: [13, 14, 15, 16], anchor: 15 }], 1500);
  assert.equal(state.markers[0].id, id);
  assert.equal(state.markers[0].phase, "idle");
  state = updateEffectPresentation(state, [], 2000);
  assert.equal(state.markers[0].phase, "leave");
  assert.equal(state.markers[0].anchor, 15);
  assert.equal(state.markers[0].until, 2230);
  state = updateEffectPresentation(state, [], 2100);
  assert.equal(state.markers[0].until, 2230);
  assert.deepEqual(finishEffectAnimation(state, id).markers, []);
});

test("effect feedback cancels an exit on undo and keeps split and merged region identities", async () => {
  const { initialEffectPresentation, updateEffectPresentation, finishEffectAnimation } = await import("../lib/effect-feedback.ts");
  const region = { kind: "wind", label: "바람", cells: [13, 14, 15], anchor: 14 };
  let state = initialEffectPresentation([region]);
  const id = state.markers[0].id;
  state = updateEffectPresentation(state, [], 1000);
  state = updateEffectPresentation(state, [region], 1100);
  assert.equal(state.markers.length, 1);
  assert.equal(state.markers[0].id, id);
  assert.equal(state.markers[0].phase, "enter");
  state = finishEffectAnimation(state, id);
  state = updateEffectPresentation(state, [{ ...region, cells: [13], anchor: 13 }, { ...region, cells: [15], anchor: 15 }], 1500);
  assert.equal(state.markers.filter(marker => marker.phase === "idle").length, 1);
  assert.equal(state.markers.filter(marker => marker.phase === "enter").length, 1);
  state = updateEffectPresentation(state, [region], 1600);
  assert.equal(state.markers.filter(marker => marker.phase === "leave").length, 1);
  assert.equal(state.markers.find(marker => marker.phase !== "leave")!.id, id);
});

test("effect regions join adjacent active cells and update when a region splits", async () => {
  const { effectRegions } = await import("../lib/effect-regions.ts");
  const world = empty(), env = deriveEnvironment(world);
  const indices = [13, 14, 15, 27];
  for (const i of indices) env.cells[i].windX = .9;
  env.cells[40].windX = .9;
  let wind = effectRegions(env).filter(region => region.kind === "wind");
  assert.equal(wind.length, 2);
  assert.deepEqual(wind[0].cells, indices);
  assert.deepEqual(wind[1].cells, [40]);
  assert.ok(wind.every(region => region.cells.includes(region.anchor)));
  env.cells[14].windX = 0;
  wind = effectRegions(env).filter(region => region.kind === "wind");
  assert.equal(wind.length, 3);
  assert.deepEqual(wind.map(region => region.cells), [[13], [15, 27], [40]]);
});

test("different effects share cells while keeping a separate marker", async () => {
  const { effectRegions } = await import("../lib/effect-regions.ts");
  const env = deriveEnvironment(empty());
  for (const i of [13, 14, 15]) { env.cells[i].dust = .4; env.cells[i].windX = 1; }
  const regions = effectRegions(env);
  assert.equal(regions.length, 2);
  assert.deepEqual(regions[0].cells, regions[1].cells);
  assert.notEqual(regions[0].anchor, regions[1].anchor);
});

test("growing flow tiles keeps boundary mist without creating tile rain", async () => {
  const { effectRegions } = await import("../lib/effect-regions.ts");
  const { makeTileAtmosphere } = await import("../components/whistle/TileAtmosphere.ts");
  for (const count of [2, 3, 8]) {
    const world = empty(), row = 4 * world.size;
    for (let x = 1; x <= count; x++) world.terrain!.tiles[row + x].surface = "slick";
    world.terrain!.tiles[row - world.size + 1].height = 1;
    world.terrain!.tiles[row].height = 1;
    world.terrain!.tiles[row + world.size + 1].height = 1;
    const env = deriveEnvironment(world);
    const regions = effectRegions(env);
    assert.ok(env.cells[row + 1].fog > .05);
    assert.ok(regions.some(region => region.kind === "fog"));
    assert.equal(regions.some(region => region.kind === "rain"), false);
    const atmosphere = makeTileAtmosphere(world, env, { value: 0 });
    const particles = atmosphere.group.getObjectByName("tile-particles") as THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
    assert.equal(particles.geometry.getAttribute("position").count, 0);
    particles.geometry.dispose(); particles.material.dispose();
  }
});

test("updraft particles stay over lift-supported holes and reach the floating eye height", async () => {
  const { makeTileAtmosphere } = await import("../components/whistle/TileAtmosphere.ts");
  const w = empty();
  w.terrain!.tiles[5 * w.size + 4].height = 1;
  w.terrain!.tiles[3 * w.size + 4].height = 1;
  w.terrain!.tiles[4 * w.size + 4].hole = true;
  w.terrain!.tiles[4 * w.size + 8].hole = true;
  const env = deriveEnvironment(w);
  const atmosphere = makeTileAtmosphere(w, env, { value: 0 });
  const particles = atmosphere.group.getObjectByName("tile-particles") as THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  const positions = particles.geometry.getAttribute("position");
  const kinds = particles.geometry.getAttribute("particleKind");
  let rising = 0;
  for (let i = 0; i < positions.count; i++) {
    if (kinds.getX(i) !== 2) continue;
    rising++;
    const x = (positions.getX(i) + w.size - 1) / 2, z = (positions.getZ(i) + w.size - 1) / 2;
    for (let n = 0; n < 32; n++) {
      const xx = x + Math.sin(n * Math.PI / 16) * .035;
      const zz = z + Math.cos(n * Math.PI / 16) * .035;
      assert.ok(terrainSample(w, xx, zz).coverage < .5);
      assert.ok(environmentAt(env, xx, zz).lift > .12);
    }
    const ceiling = environmentAt(env, x, z).liftCeiling;
    assert.ok(positions.getY(i) < ceiling);
    assert.ok(positions.getY(i) + 3.2 > ceiling + 1.35);
  }
  assert.ok(rising >= 24 && rising <= 80);
  w.terrain!.tiles[5 * w.size + 4].height = 0;
  const inactive = makeTileAtmosphere(w, deriveEnvironment(w), { value: 0 });
  const remaining = inactive.group.getObjectByName("tile-particles") as THREE.Points;
  assert.equal(remaining.geometry.getAttribute("position").count, 0);
  for (const points of [particles, remaining]) {
    points.geometry.dispose();
    (points.material as THREE.Material).dispose();
  }
});

test("tile atmosphere has bounded particles and no focused lights with reduced-motion support", () => {
  const w = empty();
  w.terrain!.tiles.forEach((tile, i) => {
    tile.surface = i % 3 === 0 ? "rough" : "slick";
    tile.height = 1;
    if (i % 7 === 0) tile.hole = true;
  });
  const terrain = makeTerrain(w, []);
  const particles = terrain.group.getObjectByName("tile-particles") as THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  assert.ok(particles.geometry.getAttribute("position").count <= 200);
  let lights = 0, beams = 0;
  terrain.group.traverse(object => { if (object instanceof THREE.PointLight) { lights++; assert.equal(object.castShadow, false); } if (object.name === "tile-focus-beam") beams++; });
  assert.equal(lights, 0); assert.equal(beams, 0);
  terrain.update(1000, undefined, undefined, true);
  assert.equal(particles.material.uniforms.motion.value, 0);
  const water = terrain.group.getObjectByName("generated-water") as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  assert.equal(water.material.uniforms.waterMotion.value, 0);
  terrain.update(2000, undefined, undefined, false, "rain");
  assert.equal(water.material.uniforms.rainPower.value, 1);
  assert.ok(water.material.uniforms.waveStrength.value > 1);
});


test("noon and midnight override local time without changing the supplied date", () => {
  const date = new Date(2026, 10, 17, 15, 23, 12), original = date.getTime();
  assert.equal(daylightAt(date, "noon").hour, 12);
  assert.equal(daylightAt(date, "noon").daylight, 1);
  assert.equal(daylightAt(date, "midnight").hour, 0);
  assert.equal(daylightAt(date, "midnight").sun, 0);
  assert.deepEqual(daylightAt(date, "auto"), daylightAt(date));
  assert.equal(date.getTime(), original);
  const world = empty();
  for (const mode of ["auto", "noon", "midnight"] as const) {
    world.timeOfDay = mode;
    assert.equal(validateWorld(JSON.parse(JSON.stringify(world))).timeOfDay, mode);
  }
  assert.throws(() => validateWorld({ ...world, timeOfDay: "invalid" }));
});

test("grass, bark and stones use neutral tones with stable varied grain", async () => {
  const { terrainFixtures, disposeTerrain } = await import("./terrain-fixtures.ts");
  const { stoneAppearance } = await import("../lib/stones.ts");
  const terrain = makeTerrain(terrainFixtures().mixed, []);
  const barkSeeds = new Set<number>(), barkColors = new Set<number>();
  let grasses = 0, stones = 0;
  terrain.group.traverse(object => {
    if (!["grass-tufts", "generated-trunks", "scattered-stones"].includes(object.name)) return;
    const mesh = object as THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    assert.equal(mesh.material.color.r, mesh.material.color.g);
    assert.equal(mesh.material.color.g, mesh.material.color.b);
    const colors = mesh.instanceColor;
    if (colors) for (let i = 0; i < mesh.count; i++) {
      assert.equal(colors.getX(i), colors.getY(i)); assert.equal(colors.getY(i), colors.getZ(i));
    }
    if (object.name === "generated-trunks") {
      barkSeeds.add(mesh.material.userData.neutralGrain.seed);
      barkColors.add(mesh.material.color.getHex());
      assert.ok(mesh.material.userData.surfaceProjection.baseColor.equals(mesh.material.color));
    }
    if (object.name === "grass-tufts") { grasses++; assert.equal(mesh.material.userData.neutralGrain.kind, "grass"); }
    if (object.name === "scattered-stones") stones += mesh.count;
  });
  assert.ok(grasses > 0 && stones > 0 && barkSeeds.size > 1 && barkColors.size > 1);
  const rocks = Array.from({ length: 30 }, (_, i) => stoneAppearance(89, i, 1));
  assert.equal(new Set(rocks.map(rock => rock.texture)).size, 3);
  assert.ok(rocks.every(rock => /^#([0-9a-f]{2})\1\1$/i.test(rock.color)));
  disposeTerrain(terrain.group);
});

test("connected water uses one flat level without lifting the ground between its tiles", () => {
  const world = empty();
  for (let z = 3; z <= 7; z++) for (let x = 3; x <= 7; x++)
    world.terrain!.tiles[z * world.size + x] = { height: x < 5 ? 4 : 0, surface: "slick" };
  for (let z = 3; z <= 7; z += .071) for (let x = 3; x < 7; x += .013) {
    const a = terrainSample(world, x, z).height, b = terrainSample(world, x + .00003, z).height;
    assert.ok(Math.abs(a - b) < .002, `water bed jumps at ${x},${z}: ${a} -> ${b}`);
  }
  const env = deriveEnvironment(world);
  assert.equal(env.ponds.length, 1);
  for (let x = 4; x < 5; x += .025) {
    const natural = terrainSample(world, x, 5, false).height;
    assert.equal(natural, 0);
    assert.equal(environmentAt(env, x, 5).water, -.06);
  }
});

test("a raised flat surface meets higher land at its actual shoreline", async () => {
  const { disposeTerrain } = await import("./terrain-fixtures.ts");
  for (const [high, low] of [[4, 0], [2, -1], [6, 3]]) {
    const world = empty();
    for (const tile of world.terrain!.tiles) tile.height = high + 1;
    for (let z = 3; z <= 7; z++) for (let x = 3; x <= 7; x++)
      world.terrain!.tiles[z * world.size + x] = { height: x < 5 ? high : low, surface: "slick", hole: false };
    const terrain = makeTerrain(world, []);
    terrain.group.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
    let shore = 0;
    terrain.group.traverse(object => {
      if (object.name !== "generated-water") return;
      const mesh = object as THREE.Mesh, geometry = mesh.geometry;
      const positions = geometry.getAttribute("position"), depths = geometry.getAttribute("waterDepth");
      for (const index of new Set(geometry.index!.array)) {
        assert.ok(Math.abs(positions.getY(index) - (high * LEVEL - .06)) < .00001);
        if (depths.getX(index) !== 0 || shore++ % 12 !== 0) continue;
        const point = new THREE.Vector3().fromBufferAttribute(positions, index);
        ray.ray.origin.set(point.x, 20, point.z);
        const ground = ray.intersectObject(terrain.group.children[0], false)[0];
        assert.ok(ground && Math.abs(ground.point.y - point.y) < .015, `floating shore at ${high}/${low}: ${point.toArray()}`);
      }
    });
    assert.ok(shore > 0);
    disposeTerrain(terrain.group);
  }
});

test("water floods reachable low ground, stops at high land and recedes without changing terrain", async () => {
  const { blocksWalkingStep } = await import("../lib/navigation.ts");
  const world = empty();
  for (const tile of world.terrain!.tiles) tile.height = 3;
  for (let z = 2; z <= 8; z++) for (let x = 1; x <= 5; x++) world.terrain!.tiles[z * world.size + x].height = 0;
  const source = 5 * world.size + 3;
  world.terrain!.tiles[source].surface = "slick";
  const before = structuredClone(world.terrain!.tiles);
  world.terrain!.tiles[source].height = 1;
  const raised = deriveEnvironment(world);
  assert.equal(raised.cells[5 * world.size + 1].water, LEVEL - .06);
  assert.equal(raised.cells[5 * world.size + 6].water, null);
  assert.equal(raised.cells[5 * world.size + 8].water, null);
  assert.equal(terrainSample(world, 3, 5, false).height, 0);
  assert.equal(blocksWalkingStep(world, { x: 2.49, z: 5 }, { x: 2.51, z: 5 }, []), false);
  world.terrain!.tiles[source].height = 0;
  const lowered = deriveEnvironment(world);
  assert.equal(lowered.cells[5 * world.size + 1].water, null);
  assert.deepEqual(world.terrain!.tiles, before);
});

test("open ground and drainage holes cannot accumulate a raised sheet of water", () => {
  const world = empty(), source = 5 * world.size + 5;
  world.terrain!.tiles[source] = { height: 6, surface: "slick" };
  let env = deriveEnvironment(world);
  assert.equal(env.ponds[0].level, -.06);
  assert.equal(env.ponds[0].cells.length, 1);
  for (const tile of world.terrain!.tiles) if (tile.surface !== "slick") tile.height = 2;
  env = deriveEnvironment(world);
  assert.equal(env.ponds[0].level, 2 * LEVEL - .06);
  world.terrain!.tiles[source+1] = { height: 0, surface: "plain", hole: true };
  env = deriveEnvironment(world);
  assert.equal(env.ponds[0].level, -.06);
  assert.equal(env.cells[source+1].water, null);
});
