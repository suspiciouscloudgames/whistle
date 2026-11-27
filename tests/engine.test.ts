import test from "node:test";
import assert from "node:assert/strict";
import {
  launchJump,
  resolveJump,
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
import { createAdaptiveResolution } from "../lib/render-quality.ts";

test("sustained slow rendering reduces resolution within bounds and recovers without rapid oscillation", () => {
  const resolution = createAdaptiveResolution(1);
  const run = (fps: number, seconds: number) => {
    let ratio = 1;
    for (let i = 0; i < fps * seconds; i++) ratio = resolution.sample(1000 / fps);
    return ratio;
  };
  assert.equal(run(20, 4), .75);
  assert.equal(run(20, 4), .5);
  assert.equal(run(10, 20), .5);
  assert.equal(run(40, 20), .5);
  assert.equal(run(60, 10), .5);
  assert.equal(run(60, 12), .75);
  assert.equal(run(60, 25), 1);
  assert.equal(run(60, 25), 1);
});

test("the overview can lower its resolution at a frame rate that still suits play", () => {
  const overview = createAdaptiveResolution(1, 45), play = createAdaptiveResolution(1);
  for (let i = 0; i < 160; i++) { overview.sample(25); play.sample(25); }
  assert.equal(overview.sample(25), .75);
  assert.equal(play.sample(25), 1);
});

test("brief stalls and hidden time do not lower resolution or carry an unfinished slow sample", () => {
  const resolution = createAdaptiveResolution(1);
  for (let i = 0; i < 60; i++) assert.equal(resolution.sample(50), 1);
  assert.equal(resolution.sample(10_000), 1);
  for (let i = 0; i < 60; i++) assert.equal(resolution.sample(50), 1);
  resolution.reset();
  for (let i = 0; i < 60; i++) assert.equal(resolution.sample(50), 1);
  for (let i = 0; i < 600; i++) assert.equal(resolution.sample(1000 / 60), 1);
  for (const invalid of [0, -1, NaN, Infinity]) assert.equal(resolution.sample(invalid), 1);
});

test("an already small render buffer never increases beyond its device ratio", () => {
  const resolution = createAdaptiveResolution(.4);
  for (let i = 0; i < 200; i++) assert.equal(resolution.sample(100), .4);
  for (let i = 0; i < 2000; i++) assert.equal(resolution.sample(1000 / 60), .4);
});

test("continuous two frame per second rendering still triggers the fallback", () => {
  const resolution = createAdaptiveResolution(1);
  for (let i = 0; i < 7; i++) resolution.sample(500);
  assert.equal(resolution.sample(500), .75);
  for (let i = 0; i < 7; i++) resolution.sample(500);
  assert.equal(resolution.sample(500), .5);
});

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
test("generated ponds stay at ground level with flat banks while authored raised water survives loading", async () => {
  const { generateTerrain, terrainSample, upgradeTerrain, randomSequence } = await import("../lib/terrain.ts");
  const { deriveEnvironment } = await import("../lib/environment.ts");
  const { WATER_INSET } = await import("../lib/water.ts");
  const random = randomSequence(1731);
  let waterTiles = 0;
  for (const size of [12, 24]) for (let n = 0; n < 64; n++) {
    const world = starterWorld();
    world.size = size;
    world.objects = [];
    world.terrain = generateTerrain(size, Math.floor(random() * 4294967296));
    world.terrain.tiles.forEach((tile, i) => {
      if (tile.surface !== "slick") return;
      waterTiles++;
      assert.equal(tile.height, 0);
      const x = i % size, z = Math.floor(i / size);
      for (const [dx, dz] of [[-.8, -.8], [.8, -.8], [-.8, .8], [.8, .8]])
        assert.ok(Math.abs(terrainSample(world, x + dx, z + dz, false).height) < .05);
    });
    assert.ok(deriveEnvironment(world, []).ponds.every(pond => pond.level === -WATER_INSET));
    assert.ok(world.terrain.tiles.slice(size * (size - 3)).every(tile => tile.height === 0 && tile.surface === "plain"));
  }
  assert.ok(waterTiles > 0);
  const authored = starterWorld();
  authored.terrain = generateTerrain(authored.size, 1234);
  authored.terrain.tiles[25] = { height: 3, surface: "slick", hole: false };
  const loaded = validateWorld(JSON.parse(JSON.stringify(authored)));
  assert.equal(upgradeTerrain(loaded), loaded);
  assert.deepEqual(loaded.terrain!.tiles, authored.terrain.tiles);
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
test("ladders join high terrain and four corners create a canopy", async () => {
  const { flatTerrain, deriveStructures, floorHeight } = await import(
    "../lib/terrain.ts"
  );
  const w = starterWorld();
  w.terrain = flatTerrain(w.size);
  w.objects = [];
  w.terrain.tiles[2 * w.size + 3].height = 1;
  assert.ok(!deriveStructures(w).some(s => s.kind === "stairs"));
  w.terrain.tiles[2 * w.size + 3].height = 2;
  const ladders = deriveStructures(w).filter(s => s.kind === "stairs");
  assert.equal(ladders.length, 1);
  assert.equal(ladders[0].x + ladders[0].dx, 3);
  assert.equal(ladders[0].z + ladders[0].dz, 2);
  assert.ok(
    Math.abs(floorHeight(w, 2.499, 2)! - floorHeight(w, 2.501, 2)!) < 0.007,
  );
  w.terrain.tiles[2 * w.size + 3].surface = "slick";
  assert.ok(!deriveStructures(w).some(s => s.kind === "stairs"));
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
test("symbol colors stay saturated and unique at the full asset limit", async () => {
  const { withSymbolColors, randomSymbolColor } = await import("../lib/symbol-color.ts");
  const world = starterWorld(); world.objects = []; world.rules = [];
  world.assets = Array.from({ length: 250 }, (_, i) => ({ ...world.assets[0], id: `symbol-${i}`, text: `기호 ${i}` }));
  const colored = withSymbolColors(world);
  const colors = colored.assets.map(asset => asset.glyphColor!);
  assert.equal(new Set(colors).size, 250);
  for (const color of colors) {
    const channels = [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16));
    assert.equal(Math.max(...channels), 255);
    assert.equal(Math.min(...channels), 0);
  }
  assert.ok(world.assets.every(asset => asset.glyphColor === undefined));
  assert.equal(withSymbolColors(colored), colored);
  assert.throws(() => validateWorld(JSON.parse(JSON.stringify(colored))), /20개/);
  const allowed = { ...colored, assets: colored.assets.slice(0, 20) };
  assert.deepEqual(validateWorld(JSON.parse(JSON.stringify(allowed))).assets, allowed.assets);
  const first = randomSymbolColor([], () => 0);
  assert.notEqual(randomSymbolColor([first], () => 0), first);
  assert.notEqual(randomSymbolColor([], () => .9), first);
});

test("existing symbol colors survive edits while imported duplicate colors are repaired", async () => {
  const { withSymbolColors } = await import("../lib/symbol-color.ts");
  const world = starterWorld(); world.objects = []; world.rules = [];
  world.assets = [
    { ...world.assets[0], id: "first", text: "첫째", glyphColor: "#FF00AA" },
    { ...world.assets[0], id: "duplicate", text: "둘째", glyphColor: "#ff00aa" },
    { ...world.assets[0], id: "legacy", text: "셋째" },
    { ...world.assets[0], id: "reserved", text: "넷째", glyphColor: "#00ff85" },
  ];
  const colored = withSymbolColors(world);
  assert.equal(colored.assets[0].glyphColor, "#FF00AA");
  assert.equal(colored.assets[3].glyphColor, "#00ff85");
  assert.equal(new Set(colored.assets.map(asset => asset.glyphColor!.toLowerCase())).size, 4);
  colored.assets[0].text = "수정한 내용";
  assert.equal(withSymbolColors(colored), colored);
  const broken = clone(colored); broken.assets[0].glyphColor = "red";
  assert.throws(() => validateWorld(broken));
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
  ground.geometry.computeBoundingBox();
  assert.ok(ground.geometry.boundingBox!.min.x < -w.size);
  assert.ok(ground.geometry.boundingBox!.max.z > w.size);
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
    1,
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
  assert.ok(Math.abs(jumpFrame(2, .48).y - 3.152) < 1e-10);
  assert.ok(Math.abs(jumpFrame(2, .96).y - 2) < 1e-10);
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

test("text objects retain editable content and size across world sharing", () => {
  const world = starterWorld();
  const content = "  안녕\nWhistle 😀\n".repeat(700).slice(0, 10_000);
  world.assets[0].text = content;
  world.assets[0].defaultScale = 3;
  const restored = validateWorld(JSON.parse(JSON.stringify(world)));
  assert.equal(restored.assets[0].text, content);
  assert.equal(restored.assets[0].defaultScale, 3);
  for (const invalid of [" ", "a".repeat(10_001), 42]) {
    const malformed = JSON.parse(JSON.stringify(world));
    malformed.assets[0].text = invalid;
    assert.throws(() => validateWorld(malformed));
  }
});

test("walking jumps cross a real one-tile hole at different frame rates and keep momentum after release", async () => {
  const { flatTerrain, floorHeight } = await import("../lib/terrain.ts");
  const world = starterWorld();
  world.objects = [];
  world.terrain = flatTerrain(world.size);
  world.terrain.tiles[5 * world.size + 5].height = -1;
  for (const fps of [20, 30, 60, 120]) {
    let x = 4.1;
    const flight = launchJump(floorHeight(world, x, 5, [])!, Math.PI / 2, 1, 1.5);
    let crossed = false, landed = false;
    for (let i = 0; i < fps * 2; i++) {
      flight.elapsed += 1 / fps;
      const next = x + flight.vx / fps;
      const floor = floorHeight(world, next, 5, []);
      assert.equal(blocksAirStep(jumpFrame(flight.origin, flight.elapsed).y, floor), false);
      x = next;
      crossed ||= floor === null;
      const result = resolveJump(flight, floor);
      assert.equal(result.missed, false);
      if (result.landed) { landed = true; break; }
    }
    assert.ok(crossed && landed && x > 5.6, `landing at ${fps}fps: ${x}`);
  }
});
test("standing jumps stay in place and gaps beyond jump range still cause a fall", () => {
  const standing = launchJump(0, 0, 0, 0);
  assert.equal(Math.hypot(standing.vx, standing.vz), 0);
  const flight = launchJump(0, 0, 1, 1.5);
  flight.elapsed = 1;
  assert.equal(resolveJump(flight, null).missed, true);
  assert.equal(resolveJump(flight, 0).landed, true);
  const backward = launchJump(0, 0, -1, 1.5);
  assert.ok(backward.vz > 0);
});

test("weather survives sharing, old worlds default to clear, and unknown weather is rejected", () => {
  for (const weather of ["clear", "cloud", "rain", "snow"] as const) {
    const world = starterWorld(); world.weather = weather;
    assert.equal(validateWorld(JSON.parse(JSON.stringify(world))).weather, weather);
  }
  const old = starterWorld(); delete old.weather;
  assert.equal(validateWorld(old).weather, undefined);
  assert.throws(() => validateWorld({...old, weather: "storm-script"}));
});

test("terrain permits one-level routes but blocks steep edges in either direction and across corners", async () => {
  const {blocksTerrainStep} = await import("../lib/navigation.ts");
  const {flatTerrain, floorHeight} = await import("../lib/terrain.ts");
  const w = starterWorld();
  w.objects = [];
  w.terrain = flatTerrain(w.size);
  for (let z = 0; z < w.size; z++)
    for (let x = 0; x < w.size; x++)
      w.terrain.tiles[z * w.size + x].height = Math.min(6, x);
  for (const step of [0.005, 0.025, 0.08]) {
    for (let x = 1; x < 5; x += step) {
      assert.equal(blocksTerrainStep(w, {x,z:3}, {x:x+step,z:3}), false);
      assert.equal(blocksGroundStep(floorHeight(w,x,3),floorHeight(w,x+step,3),step), false);
    }
  }
  w.terrain.tiles[3*w.size+2].height = 4;
  assert.equal(blocksTerrainStep(w, {x:1.49,z:3}, {x:1.51,z:3}), true);
  assert.equal(blocksTerrainStep(w, {x:1.51,z:3}, {x:1.49,z:3}), true);
  assert.equal(blocksTerrainStep(w, {x:1,z:3}, {x:3,z:3}), true);
  w.terrain.tiles[3*w.size+2].hole = true;
  assert.equal(blocksTerrainStep(w, {x:1.49,z:3}, {x:1.51,z:3}), false);
  w.terrain.tiles[3*w.size+2] = {height: 1, surface: "plain"};
  w.terrain.tiles[4*w.size+1].height = 4;
  w.terrain.tiles[4*w.size+2].height = 1;
  assert.equal(blocksTerrainStep(w, {x:1.49,z:3.49}, {x:1.51,z:3.51}), true);
  const bridge = {kind: "bridge" as const, x:2,z:3,height:1,dx:1,dz:0,key:"bridge:2:3"};
  w.terrain.tiles[3*w.size+2].hole = true;
  assert.equal(blocksTerrainStep(w, {x:1.49,z:3}, {x:1.51,z:3}, [bridge]), false);
});

test("ladders along one cliff stay three tiles apart and removed routes block walking", async () => {
  const { flatTerrain, deriveStructures } = await import("../lib/terrain.ts");
  const { blocksWalkingStep } = await import("../lib/navigation.ts");
  for (const axis of ["x", "z"] as const) {
    const world = starterWorld(); world.objects = []; world.terrain = flatTerrain(world.size);
    for (let z = 0; z < world.size; z++) for (let x = 0; x < world.size; x++)
      world.terrain.tiles[z * world.size + x].height = (axis === "x" ? x : z) >= 4 ? 2 : 0;
    const structures = deriveStructures(world);
    const ladders = structures.filter(s => s.kind === "stairs");
    assert.equal(ladders.length, Math.ceil(world.size / 3));
    for (let i = 0; i < ladders.length; i++) for (let j = i + 1; j < ladders.length; j++)
      assert.ok(Math.hypot(ladders[i].x - ladders[j].x, ladders[i].z - ladders[j].z) >= 3);
    const point = (along: number) => axis === "x" ? {x: along, z: 1} : {x: 1, z: along};
    assert.equal(blocksWalkingStep(world, point(3.49), point(3.51), structures), true);
    assert.deepEqual(deriveStructures(world), structures);
  }
});

test("nearby disconnected upper and lower regions each retain ladder access", async () => {
  const { flatTerrain, deriveStructures } = await import("../lib/terrain.ts");
  for (const isolatedHeight of [0, 2]) {
    const world = starterWorld(); world.objects = []; world.terrain = flatTerrain(world.size);
    for (const tile of world.terrain.tiles) tile.height = 2 - isolatedHeight;
    for (const x of [2, 4]) world.terrain.tiles[3 * world.size + x].height = isolatedHeight;
    const ladders = deriveStructures(world).filter(s => s.kind === "stairs");
    assert.equal(ladders.length, 2);
    for (const x of [2, 4]) assert.ok(ladders.some(s => isolatedHeight === 0
      ? s.x === x && s.z === 3
      : s.x + s.dx === x && s.z + s.dz === 3));
  }
});

test("adjacent ladders to different terrain levels remain climbable", async () => {
  const { flatTerrain, deriveStructures } = await import("../lib/terrain.ts");
  const { blocksWalkingStep } = await import("../lib/navigation.ts");
  const world = starterWorld(); world.objects = []; world.terrain = flatTerrain(world.size);
  for (let z = 0; z < world.size; z++) for (let x = 0; x < world.size; x++)
    world.terrain.tiles[z * world.size + x].height = x >= 4 ? 4 : x >= 3 ? 2 : 0;
  const structures = deriveStructures(world);
  for (const x of [2, 3]) {
    assert.ok(structures.some(s => s.kind === "stairs" && s.x === x && s.z === 0));
    assert.equal(blocksWalkingStep(world, {x: x + .49, z: 0}, {x: x + .51, z: 0}, structures), false);
  }
});

test("high edges require the narrow ladder route, including maximum rise and descent", async () => {
  const {blocksWalkingStep} = await import("../lib/navigation.ts");
  const {flatTerrain,deriveStructures} = await import("../lib/terrain.ts");
  for (const rise of [1,2,6]) for (const axis of ["x","z"] as const) {
    const world=starterWorld(); world.objects=[]; world.terrain=flatTerrain(world.size);
    for(let z=0;z<world.size;z++) for(let x=0;x<world.size;x++)
      world.terrain.tiles[z*world.size+x].height=(axis === "x" ? x : z)>=4 ? rise : 0;
    const structures=deriveStructures(world);
    assert.equal(structures.some(s=>s.kind === "stairs"),rise>=2);
    const point=(along:number,across=3)=>axis === "x" ? {x:along,z:across} : {x:across,z:along};
    for(let i=0;i<100;i++) {
      const from=point(3+i/100),to=point(3+(i+1)/100);
      assert.equal(blocksWalkingStep(world,from,to,structures),false,`rise ${rise}, ${axis}, step ${i}`);
      assert.equal(blocksWalkingStep(world,to,from,structures),false);
    }
    assert.equal(blocksWalkingStep(world,point(3.49,3.32),point(3.51,3.32),structures),rise>=2);
    assert.equal(blocksWalkingStep(world,point(3.49),point(3.51),[]),rise>=2);
    world.terrain.patterns.stairs=false;
    assert.equal(deriveStructures(world).some(s=>s.kind === "stairs"),false);
  }
});

test("updrafts turn a full circle in 90 seconds and stop turning on release or landing", async () => {
  const { environmentalFlight, stepEnvironmentalFlight } = await import("../lib/environment-motion.ts");
  const conditions = { lift: .65, liftCeiling: 2, crouching: false };
  for (const fps of [30, 60, 120]) {
    let flight = environmentalFlight("float", 2), yaw = 0;
    for (let i = 0; i < fps * 90; i++) {
      const result = stepEnvironmentalFlight(flight, 1 / fps, null, conditions);
      flight = result.flight;
      yaw += result.yawDelta;
      assert.equal(result.missed || result.landed, false);
    }
    assert.ok(Math.abs(yaw - Math.PI * 2) < 1e-10);
    assert.ok(Math.abs(flight.y - 2) < .001);
    assert.equal(stepEnvironmentalFlight(flight, 1 / fps, null, { ...conditions, lift: 0 }).yawDelta, 0);
    assert.equal(stepEnvironmentalFlight(flight, 1 / fps, null, { ...conditions, crouching: true }).yawDelta, 0);
    assert.equal(stepEnvironmentalFlight(flight, 1 / fps, 2, conditions).yawDelta, 0);
  }
});

test("floating holds height and releases into gravity or lands", async () => {
  const { environmentalFlight, stepEnvironmentalFlight } = await import("../lib/environment-motion.ts");
  const lifting = { lift: .65, liftCeiling: 2, crouching: false };
  let state = environmentalFlight("float", 1);
  for (let i = 0; i < 300; i++) state = stepEnvironmentalFlight(state, 1 / 60, null, lifting).flight;
  assert.ok(Math.abs(state.y - 2) < .03);
  const released = stepEnvironmentalFlight(state, .1, null, { ...lifting, crouching: true });
  assert.ok(released.flight.y < state.y);
  const exited = stepEnvironmentalFlight(state, .1, null, { ...lifting, lift: 0 });
  assert.ok(exited.flight.y < state.y);
  let landed = false;
  for (let i = 0; i < 180; i++) {
    const result = stepEnvironmentalFlight(state, 1 / 60, 0, { ...lifting, lift: 0 });
    state = result.flight;
    if (result.landed) { landed = true; break; }
  }
  assert.equal(landed, true);
  assert.equal(state.y, 0);
});
