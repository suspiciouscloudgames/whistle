import test from "node:test";
import assert from "node:assert/strict";
import {
  jumpFrame,
  movementProfile,
  blocksAirStep,
  followHeading,
  movementKey,
  fallFrame,
  FALL_SECONDS,
  blocksGroundStep,
} from "../lib/navigation.ts";
import { eraseBackground, cropBounds } from "../lib/image-edit.ts";
test("movement follows physical WASD keys across Korean input and Caps Lock", () => {
  for (const [code, korean, expected] of [
    ["KeyW", "ㅈ", "w"],
    ["KeyA", "ㅁ", "a"],
    ["KeyS", "ㄴ", "s"],
    ["KeyD", "ㅇ", "d"],
  ]) {
    assert.equal(movementKey({ code, key: korean }), expected);
    assert.equal(movementKey({ code, key: expected.toUpperCase() }), expected);
    assert.equal(movementKey({ code, key: "Process" }), expected);
  }
  assert.equal(movementKey({ code: "ArrowUp", key: "ArrowUp" }), "arrowup");
  assert.equal(movementKey({ code: "", key: "W" }), "w");
  assert.equal(movementKey({ code: "KeyQ", key: "w" }), null);
  assert.equal(movementKey({ code: "Space", key: " " }), null);
});
test("holes admit walking, descent accelerates for two seconds, and the reset is covered", () => {
  assert.equal(blocksGroundStep(0, null, 0.025), false);
  assert.equal(blocksGroundStep(0, 1, 0.025), true);
  assert.equal(blocksGroundStep(0, 0.05, 0.025), false);
  const start = fallFrame(1.35, 0),
    middle = fallFrame(1.35, 1),
    end = fallFrame(1.35, FALL_SECONDS);
  assert.equal(start.y, 1.35);
  assert.equal(middle.done, false);
  assert.ok(middle.y < start.y);
  assert.ok(end.y < middle.y);
  assert.equal(end.done, true);
  assert.equal(end.fade, 1);
  assert.equal(fallFrame(1.35, FALL_SECONDS - 0.01).fade, 1);
  assert.deepEqual(fallFrame(1.35, 100), end);
});

test("irregular hole rims stay seeded, match visible ground, and remain covered by bridges", async () => {
  const { flatTerrain, terrainSample, floorHeight, deriveStructures } =
    await import("../lib/terrain.ts");
  const { makeTerrain } = await import("../components/whistle/TerrainScene.ts");
  const THREE = await import("three");
  const w = starterWorld();
  w.objects = [];
  w.terrain = flatTerrain(w.size);
  for (const [x, z] of [
    [5, 5],
    [8, 6],
  ])
    w.terrain.tiles[z * w.size + x].height = -1;
  const radius = (cx: number, cz: number, angle: number) => {
    let lo = 0,
      hi = 1;
    for (let i = 0; i < 20; i++) {
      const r = (lo + hi) / 2;
      if (
        floorHeight(
          w,
          cx + Math.cos(angle) * r,
          cz + Math.sin(angle) * r,
          [],
        ) === null
      )
        lo = r;
      else hi = r;
    }
    return (lo + hi) / 2;
  };
  const radii = Array.from({ length: 16 }, (_, i) =>
    radius(5, 5, (i * Math.PI) / 8),
  );
  assert.ok(Math.max(...radii) - Math.min(...radii) > 0.08);
  assert.ok(
    radii.some((r, i) => Math.abs(r - radius(8, 6, (i * Math.PI) / 8)) > 0.03),
  );
  const saved = validateWorld(JSON.parse(JSON.stringify(w)));
  for (let x = 4.3; x < 5.8; x += 0.11)
    assert.deepEqual(terrainSample(w, x, 5.23), terrainSample(saved, x, 5.23));
  const terrain = makeTerrain(w, []),
    ground = terrain.group.children[0] as InstanceType<typeof THREE.Mesh>;
  const ray = new THREE.Raycaster();
  for (let z = 4.3; z < 5.8; z += 0.12)
    for (let x = 4.3; x < 5.8; x += 0.12) {
      if (Math.abs(terrainSample(w, x, z).coverage - 0.5) < 0.035) continue;
      ray.set(
        new THREE.Vector3(x * 2 - w.size + 1, 10, z * 2 - w.size + 1),
        new THREE.Vector3(0, -1, 0),
      );
      assert.equal(
        ray.intersectObject(ground).length > 0,
        floorHeight(w, x, z, []) !== null,
      );
    }
  for (const x of [4, 6])
    w.objects.push({
      id: `bridge-${x}`,
      asset: w.assets[0].id,
      x,
      z: 5,
      rotation: 0,
      scale: 1,
    });
  assert.equal(floorHeight(w, 5, 5, deriveStructures(w)), 0);
  terrain.group.traverse((o) => {
    const m = o as InstanceType<typeof THREE.Mesh>;
    m.geometry?.dispose();
    if (m.material && !Array.isArray(m.material)) m.material.dispose();
  });
});
import {
  starterWorld,
  abstractWorld,
  type World,
  createSimulation,
  stepSimulation,
  validateWorld,
  clone,
  type Rule,
} from "../lib/world.ts";
test("background erasing preserves enclosed matching colors and never mutates the source", () => {
  const data = new Uint8ClampedArray(5 * 5 * 4).fill(255);
  for (let y = 1; y < 4; y++)
    for (let x = 1; x < 4; x++) {
      if (x === 2 && y === 2) continue;
      data.set([20, 20, 20, 255], (y * 5 + x) * 4);
    }
  const result = eraseBackground(data, 5, 5, 0, 0, 10);
  assert.equal(result[3], 0);
  assert.equal(result[(2 * 5 + 2) * 4 + 3], 255);
  assert.equal(result[(1 * 5 + 1) * 4 + 3], 255);
  assert.equal(data[3], 255);
  assert.deepEqual(eraseBackground(result, 5, 5, 0, 0, 100), result);
});
test("background tolerance is adjustable and crop bounds work in every drag direction", () => {
  const data = new Uint8ClampedArray([
    255, 255, 255, 255, 230, 230, 230, 255, 0, 0, 0, 255,
  ]);
  assert.equal(eraseBackground(data, 3, 1, 0, 0, 0)[7], 255);
  assert.equal(eraseBackground(data, 3, 1, 0, 0, 10)[7], 0);
  assert.equal(eraseBackground(data, 3, 1, 0, 0, 10)[11], 255);
  assert.deepEqual(cropBounds({ x: 240, y: 200 }, { x: -10, y: 40 }, 256), {
    x: 0,
    y: 40,
    width: 240,
    height: 160,
  });
});
test("original photo survives a world round trip and rejects unsafe sources", () => {
  const world = starterWorld();
  world.assets[0].originalImage = "data:image/png;base64,iVBORw0KGgo=";
  assert.equal(
    validateWorld(JSON.parse(JSON.stringify(world))).assets[0].originalImage,
    world.assets[0].originalImage,
  );
  world.assets[0].originalImage = "javascript:alert(1)";
  assert.throws(() => validateWorld(world));
});
test("camera turns smoothly across north without frame-rate dependent speed", () => {
  const start = (179 * Math.PI) / 180;
  const target = (-179 * Math.PI) / 180;
  const next = followHeading(start, target, 1 / 60);
  assert.ok(next > start && next < (181 * Math.PI) / 180);
  let at30 = 0,
    at120 = 0;
  for (let i = 0; i < 30; i++) at30 = followHeading(at30, Math.PI / 2, 1 / 30);
  for (let i = 0; i < 120; i++)
    at120 = followHeading(at120, Math.PI / 2, 1 / 120);
  assert.ok(Math.abs(at30 - at120) < 1e-10);
  assert.ok(
    at30 <= 0.6 + 1e-10,
    "turn speed is capped at 0.6 radians per second",
  );
  assert.ok(at30 > 0.5, "camera still responds to turns");
  assert.equal(followHeading(0, Math.PI, 0), 0);
});
function fixture(): World {
  const w = starterWorld();
  w.assets = [
    { id: "cup", name: "A", shape: "sphere", color: "#111111", solid: false },
    { id: "flower", name: "B", shape: "cone", color: "#111111", solid: false },
    { id: "gate", name: "C", shape: "bar", color: "#111111", solid: true },
    { id: "tree", name: "D", shape: "box", color: "#111111", solid: true },
    { id: "rock", name: "E", shape: "diamond", color: "#111111", solid: false },
    { id: "orb", name: "F", shape: "ring", color: "#111111", solid: false },
  ];
  w.objects = [
    ["cup", 6, 8],
    ["flower", 6, 6],
    ["flower", 6, 4],
    ["flower", 7, 3],
    ["gate", 7, 1],
  ].map(([asset, x, z]) => ({
    id: asset + "-" + x + "-" + z,
    asset: asset as string,
    x: x as number,
    z: z as number,
    rotation: 0,
    scale: 1,
  }));
  const r: Rule = {
    id: "r1",
    subject: "cup",
    trigger: "gaze",
    token: "a",
    source: "*",
    radius: 4,
    action: "mark",
    result: "a",
    replacement: "",
    enabled: true,
  };
  w.rules = [
    r,
    { ...r, id: "r2", subject: "flower", trigger: "neighbor", radius: 2.2 },
    { ...r, id: "r3", subject: "flower", trigger: "marked", action: "sound" },
    {
      ...r,
      id: "r4",
      subject: "gate",
      trigger: "neighbor",
      source: "flower",
      radius: 2.2,
      action: "disappear",
    },
  ];
  return w;
}

test("changing the editor symbol preserves media and spatial rule behavior", () => {
  const world = fixture();
  const image = "data:image/png;base64,iVBORw0KGgo=";
  world.assets[0].image = image;
  const before = stepSimulation(world, createSimulation(world), {
    x: 6,
    z: 10,
    yaw: 0,
  });
  const changed = clone(world);
  changed.assets[0].shape = "bar";
  const loaded = validateWorld(changed);
  assert.equal(loaded.assets[0].image, image);
  const after = stepSimulation(loaded, createSimulation(loaded), {
    x: 6,
    z: 10,
    yaw: 0,
  });
  assert.deepEqual(after.actors, before.actors);
  assert.deepEqual(after.events, before.events);
});
test("gaze starts a spatial chain and removes a target without changing the original world", () => {
  const world = fixture(),
    original = JSON.stringify(world);
  let sim = createSimulation(world);
  const events = [];
  for (let i = 0; i < 7; i++) {
    sim = stepSimulation(world, sim, { ...world.start, yaw: 0 });
    events.push(...sim.events);
  }
  assert.equal(sim.actors.filter((a) => a.marks.includes("a")).length, 4);
  assert.equal(sim.actors.find((a) => a.asset === "gate")?.removed, true);
  assert.equal(events.filter((e) => e.action === "sound").length, 3);
  assert.equal(JSON.stringify(world), original);
});
test("moving a symbol out of range interrupts the chain", () => {
  const world = fixture();
  world.objects.find((a) => a.id === "flower-6-6")!.x = 0;
  let sim = createSimulation(world);
  for (let i = 0; i < 8; i++)
    sim = stepSimulation(world, sim, { ...world.start, yaw: 0 });
  assert.equal(sim.actors.filter((a) => a.marks.length).length, 1);
  assert.equal(sim.actors.find((a) => a.asset === "gate")?.removed, false);
});
test("gaze requires facing the object and respects solid occlusion", () => {
  const world = fixture();
  let sim = stepSimulation(world, createSimulation(world), {
    ...world.start,
    yaw: Math.PI,
  });
  assert.equal(sim.events.length, 0);
  world.objects.push({
    id: "blocker",
    asset: "tree",
    x: 6,
    z: 9,
    rotation: 0,
    scale: 1,
  });
  sim = stepSimulation(world, createSimulation(world), {
    ...world.start,
    yaw: 0,
  });
  assert.equal(sim.events.length, 0);
});
test("disabled rules do not run; sound only fires on a newly matching condition", () => {
  const world = fixture();
  world.rules[0].enabled = false;
  let sim = createSimulation(world);
  for (let i = 0; i < 5; i++)
    sim = stepSimulation(world, sim, { ...world.start, yaw: 0 });
  assert.equal(sim.actors.filter((a) => a.marks.length).length, 0);
  world.rules[0].enabled = true;
  let count = 0;
  for (let i = 0; i < 20; i++) {
    sim = stepSimulation(world, sim, { ...world.start, yaw: 0 });
    count += sim.events.filter((e) => e.action === "sound").length;
  }
  assert.equal(count, 3);
});
test("snapshot steps propagate changes one relation at a time", () => {
  const world = fixture();
  const sim = stepSimulation(world, createSimulation(world), {
    ...world.start,
    yaw: 0,
  });
  assert.equal(sim.actors.filter((a) => a.marks.length).length, 1);
  const next = stepSimulation(world, sim, { ...world.start, yaw: 0 });
  assert.equal(next.actors.filter((a) => a.marks.length).length, 2);
});
test("change and move actions are bounded and stop at occupied cells", () => {
  const world = fixture();
  world.rules = [{ ...world.rules[0], action: "change", replacement: "orb" }];
  let sim = stepSimulation(world, createSimulation(world), {
    ...world.start,
    yaw: 0,
  });
  assert.equal(sim.actors.find((a) => a.id === "cup-6-8")?.asset, "orb");
  world.rules = [{ ...world.rules[0], action: "move" }];
  sim = stepSimulation(world, createSimulation(world), {
    ...world.start,
    yaw: 0,
  });
  assert.equal(sim.actors.find((a) => a.id === "cup-6-8")?.z, 7);
  world.objects.push({
    id: "block",
    asset: "rock",
    x: 6,
    z: 7,
    scale: 1,
    rotation: 0,
  });
  sim = stepSimulation(world, createSimulation(world), {
    ...world.start,
    yaw: 0,
  });
  assert.equal(sim.actors.find((a) => a.id === "cup-6-8")?.z, 8);
});
test("untrusted world data rejects executable image URLs and invalid coordinates", () => {
  const good = fixture();
  assert.deepEqual(validateWorld(good), good);
  const bad = clone(good);
  bad.assets[0].image = "javascript:alert(1)";
  assert.throws(() => validateWorld(bad));
  const outside = clone(good);
  outside.objects[0].x = 999;
  assert.throws(() => validateWorld(outside));
  const invalid = clone(good);
  invalid.rules[0].action = "eval" as Rule["action"];
  assert.throws(() => validateWorld(invalid));
});

test("image size presets and extra-large placements survive file round trips, including older worlds", () => {
  const world = starterWorld();
  assert.equal(validateWorld(clone(world)).assets[0].defaultScale, undefined);
  for (const scale of [0.5, 1, 2, 3]) {
    world.assets[0].defaultScale = scale;
    world.objects[0].scale = scale;
    assert.deepEqual(validateWorld(JSON.parse(JSON.stringify(world))), world);
  }
  for (const scale of [-1, 0, 4, NaN]) {
    const invalid = clone(world);
    invalid.assets[0].defaultScale = scale;
    assert.throws(() => validateWorld(invalid));
  }
  world.objects[0].scale = 4;
  assert.throws(() => validateWorld(world));
});

test("abstract defaults have no assigned behavior; migration preserves the original and user rules", () => {
  const fresh = starterWorld();
  assert.equal(fresh.rules.length, 0);
  assert.ok(fresh.assets.every((a) => !a.solid));
  const legacy = fixture();
  legacy.title = "잠든 정원";
  legacy.assets[0].shape = "bell";
  legacy.assets[0].name = "작은 종";
  legacy.rules[0] = { ...legacy.rules[0], token: "별", result: "별" };
  legacy.rules.push({ ...legacy.rules[0], id: "custom", action: "sound" });
  const before = JSON.stringify(legacy),
    migrated = abstractWorld(legacy);
  assert.equal(JSON.stringify(legacy), before);
  assert.equal(migrated.title, "무제");
  assert.equal(migrated.assets[0].shape, "sphere");
  assert.ok(!migrated.rules.some((r) => r.id === "r1"));
  assert.ok(migrated.rules.some((r) => r.id === "custom"));
  assert.deepEqual(validateWorld(migrated), migrated);
});

test("seeded terrain repeats exactly and preserves a grounded entrance", async () => {
  const { generateTerrain } = await import("../lib/terrain.ts");
  const a = generateTerrain(12, 1234),
    b = generateTerrain(12, 1234);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.tiles, generateTerrain(12, 5678).tiles);
  assert.ok(a.tiles.every((t) => t.height >= 0));
  assert.ok(a.tiles.slice(108).every((t) => t.height === 0));
});
test("matching symbols bridge only aligned equal-height gaps and removal reverses it", async () => {
  const { flatTerrain, deriveStructures, floorHeight, LEVEL } = await import(
    "../lib/terrain.ts"
  );
  const w = starterWorld();
  w.terrain = flatTerrain(w.size);
  w.objects = [];
  w.terrain.tiles[2 * w.size + 3].height = -1;
  for (const x of [2, 4]) {
    w.terrain.tiles[2 * w.size + x].height = 1;
    w.objects.push({
      id: String(x),
      asset: "circle",
      x,
      z: 2,
      rotation: 0,
      scale: 1,
    });
  }
  assert.equal(
    deriveStructures(w).filter((s) => s.kind === "bridge").length,
    1,
  );
  assert.equal(floorHeight(w, 3, 2), LEVEL);
  w.objects[1].asset = "square";
  assert.equal(floorHeight(w, 3, 2), null);
  w.objects[1].asset = "circle";
  w.terrain.patterns.bridge = false;
  assert.equal(floorHeight(w, 3, 2), null);
  w.terrain.patterns.bridge = true;
  w.objects.pop();
  assert.equal(floorHeight(w, 3, 2), null);
});
test("stairs join same-surface levels continuously and four corners create a canopy", async () => {
  const { flatTerrain, deriveStructures, floorHeight } = await import(
    "../lib/terrain.ts"
  );
  const w = starterWorld();
  w.terrain = flatTerrain(w.size);
  w.objects = [];
  w.terrain.tiles[2 * w.size + 3].height = 1;
  assert.ok(
    deriveStructures(w).some(
      (s) => s.kind === "stairs" && s.x === 2 && s.z === 2,
    ),
  );
  assert.ok(
    Math.abs(floorHeight(w, 2.499, 2)! - floorHeight(w, 2.501, 2)!) < 0.004,
  );
  w.terrain.tiles[2 * w.size + 3].surface = "rough";
  assert.ok(
    !deriveStructures(w).some(
      (s) => s.kind === "stairs" && s.x === 2 && s.z === 2,
    ),
  );
  for (const [x, z] of [
    [1, 1],
    [3, 1],
    [1, 3],
    [3, 3],
  ])
    w.objects.push({
      id: `${x},${z}`,
      asset: "circle",
      x,
      z,
      rotation: 0,
      scale: 1,
    });
  assert.equal(
    deriveStructures(w).filter((s) => s.kind === "canopy").length,
    1,
  );
  const before = clone(w.terrain);
  w.objects.pop();
  assert.equal(
    deriveStructures(w).filter((s) => s.kind === "canopy").length,
    0,
  );
  assert.deepEqual(w.terrain, before);
});
test("terrain survives serialization and legacy worlds stay flat; malformed terrain is rejected", async () => {
  const { generateTerrain, floorHeight } = await import("../lib/terrain.ts");
  const w = starterWorld();
  assert.equal(floorHeight(w, 5, 5), 0);
  w.terrain = generateTerrain(w.size, 1234);
  assert.deepEqual(validateWorld(JSON.parse(JSON.stringify(w))), w);
  const broken = clone(w);
  broken.terrain!.tiles.pop();
  assert.throws(() => validateWorld(broken));
  const bad = clone(w);
  bad.terrain!.tiles[0].height = 99;
  assert.throws(() => validateWorld(bad));
  const hole = clone(w);
  hole.terrain!.tiles[w.start.z * w.size + w.start.x].height = -1;
  assert.throws(() => validateWorld(hole));
});

test("3D terrain is a shared seamless surface and natural slopes stay continuous", async () => {
  const { flatTerrain, terrainSample, floorHeight, deriveStructures } =
    await import("../lib/terrain.ts");
  const { makeTerrain } = await import("../components/whistle/TerrainScene.ts");
  const THREE = await import("three");
  const w = starterWorld();
  w.terrain = flatTerrain(w.size);
  w.objects = [];
  const flat = makeTerrain(w, []);
  const ground = flat.group.children[0] as InstanceType<typeof THREE.Mesh>;
  assert.equal(
    ground.geometry.getAttribute("position").count,
    (w.size * 12 + 1) ** 2,
  );
  assert.equal(
    flat.group.children.some((o) => o instanceof THREE.InstancedMesh),
    false,
  );
  assert.ok(
    [...ground.geometry.getAttribute("position").array].every(Number.isFinite),
  );
  w.terrain.tiles[5 * w.size + 5] = { height: 2, surface: "soft" };
  assert.equal(
    deriveStructures(w).filter((s) => s.kind === "stairs").length,
    0,
  );
  let previous = floorHeight(w, 4, 5)!;
  for (let x = 4.01; x <= 6; x += 0.01) {
    const next = floorHeight(w, x, 5)!;
    assert.ok(Math.abs(next - previous) < 0.04);
    previous = next;
  }
  const blended = terrainSample(w, 4.5, 5);
  assert.ok(blended.weights.soft > 0.4 && blended.weights.plain > 0.4);
  const natural = makeTerrain(w, []),
    vertices = (
      natural.group.children[0] as InstanceType<typeof THREE.Mesh>
    ).geometry.getAttribute("position");
  for (let i = 0; i < vertices.count; i += 113) {
    const x = (vertices.getX(i) + w.size - 1) / 2,
      z = (vertices.getZ(i) + w.size - 1) / 2;
    assert.ok(
      Math.abs(vertices.getY(i) - terrainSample(w, x, z).height) < 0.00001,
    );
  }
  for (const built of [flat, natural])
    built.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => m.dispose());
        if (o instanceof THREE.InstancedMesh) o.dispose();
      }
    });
});

test("old generated trench is repaired once without erasing authored terrain or media", async () => {
  const { generateTerrain, upgradeTerrain } = await import("../lib/terrain.ts");
  const w = starterWorld();
  w.terrain = generateTerrain(w.size, 9921);
  const clean = clone(w.terrain);
  delete w.terrain.generatorVersion;
  const x = Math.floor(w.size / 2),
    z = Math.floor(w.size / 2) - 1;
  for (let row = 1; row < w.size - 3; row++)
    w.terrain.tiles[row * w.size + x] = { height: -1, surface: "plain" };
  for (const col of [x - 1, x + 1])
    w.terrain.tiles[z * w.size + col] = { height: 1, surface: "plain" };
  w.terrain.tiles[1] = { height: -1, surface: "rough" };
  w.terrain.tiles[2 * w.size + x] = { height: 3, surface: "soft" };
  w.assets[0].image = "data:image/png;base64,aGVsbG8=";
  const source = clone(w),
    next = upgradeTerrain(w);
  assert.deepEqual(w, source);
  assert.deepEqual(next.objects, w.objects);
  assert.deepEqual(next.assets, w.assets);
  assert.deepEqual(next.terrain!.tiles[1], { height: -1, surface: "rough" });
  assert.deepEqual(next.terrain!.tiles[2 * w.size + x], {
    height: 3,
    surface: "soft",
  });
  assert.deepEqual(
    next.terrain!.tiles[3 * w.size + x],
    clean.tiles[3 * w.size + x],
  );
  assert.equal(upgradeTerrain(next), next);
});

test("the 2D edge continues into walkable white space while authored holes remain holes", async () => {
  const { flatTerrain, floorHeight } = await import("../lib/terrain.ts");
  const w = starterWorld();
  w.terrain = flatTerrain(w.size);
  w.objects = [];
  w.terrain.tiles[0].height = 2;
  assert.ok(
    Math.abs(floorHeight(w, -0.499, 0)! - floorHeight(w, -0.501, 0)!) < 0.001,
  );
  assert.equal(floorHeight(w, -10, 0), 0);
  assert.equal(floorHeight(w, 100, 100), 0);
  w.terrain.tiles[5 * w.size + 5].height = -1;
  assert.equal(floorHeight(w, 5, 5), null);
});

test("grass has continuous cover inside a patch while paths and holes stay clear", async () => {
  const { flatTerrain } = await import("../lib/terrain.ts");
  const { grassCoverAt } = await import("../components/whistle/Grass.ts");
  const w = starterWorld();
  w.terrain = flatTerrain(w.size);
  for (let z = 3; z <= 6; z++)
    for (let x = 3; x <= 6; x++)
      w.terrain.tiles[z * w.size + x].surface = "soft";
  for (let z = 3; z < 6; z += 0.17)
    for (let x = 3; x < 6; x += 0.17)
      assert.equal(grassCoverAt(w, x, z, []), 1);
  assert.equal(grassCoverAt(w, 0, 0, []), 0);
  w.terrain.tiles[4 * w.size + 4].height = -1;
  assert.equal(grassCoverAt(w, 4, 4, []), 0);
  assert.equal(
    grassCoverAt(w, 5, 5, [
      { key: "path", kind: "stairs", x: 5, z: 5, dx: 1, dz: 0, height: 1 },
    ]),
    0,
  );
});

test("jump rises, peaks, and lands without blocking horizontal movement over lower ground", () => {
  assert.equal(jumpFrame(2, 0).y, 2);
  assert.equal(jumpFrame(2, .4).y, 2.8);
  assert.ok(Math.abs(jumpFrame(2, .8).y - 2) < 1e-10);
  assert.equal(jumpFrame(2, .2).descending, false);
  assert.equal(jumpFrame(2, .6).descending, true);
  assert.equal(blocksAirStep(2.8, 2), false);
  assert.equal(blocksAirStep(2.8, null), false);
  assert.equal(blocksAirStep(2.8, 3.5), true);
});
test("run and crouch change speed without changing turning sensitivity", () => {
  const walk = movementProfile(false, false);
  const run = movementProfile(true, false);
  const crouch = movementProfile(false, true);
  assert.equal(run.eyeHeight, walk.eyeHeight);
  assert.ok(run.speed > walk.speed);
  assert.ok(crouch.speed < walk.speed);
  assert.ok(crouch.eyeHeight < walk.eyeHeight);
  assert.deepEqual(movementProfile(true, true), crouch);
});
