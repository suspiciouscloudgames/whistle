import { test, expect, type Page } from "@playwright/test";
import { terrainFixtures } from "../terrain-fixtures";
import { openPlaced } from "./presentation";

test.use({ viewport: { width: 520, height: 700 } });
test.setTimeout(90_000);

async function open(page: Page, artwork = false) {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.route(/\/components\/whistle\/Scene\.tsx(\?|$)/, async route => {
    const response = await route.fetch();
    const body = (await response.text())
      .replace("const scene = new THREE.Scene();", "const scene = new THREE.Scene(); globalThis.__performanceScene = scene;")
      .replace("const portalScene = createPortalScene(world.size);", "globalThis.__performancePlayer = player; globalThis.__performanceActors = actors; const portalScene = createPortalScene(world.size);")
      .replace("pixelRenderer.render(scene, camera);", "pixelRenderer.render(scene, camera); globalThis.__draws = (globalThis.__draws ?? 0) + 1;");
    await route.fulfill({ response, body });
  });
  const world = terrainFixtures().flat;
  world.timeOfDay = "noon";
  if (artwork) world.objects = [{ id: "perf-art", asset: world.assets[0].id, x: 6, z: 6, rotation: 0, scale: 2 }];
  await page.addInitScript(({ world, artwork }) => {
    Object.defineProperty(window, "devicePixelRatio", { value: .5 });
    if (artwork) {
      const canvas = document.createElement("canvas"); canvas.width = canvas.height = 32;
      const context = canvas.getContext("2d")!; context.fillStyle = "red"; context.fillRect(0, 0, 32, 32);
      world.assets[0].image = canvas.toDataURL();
    }
    localStorage.setItem("whistle.world.v2", JSON.stringify(world));
    localStorage.setItem("whistle.language", "ko");
  }, { world, artwork });
  await page.goto(`?meeting=scene-performance-${Date.now()}`);
  await expect(page.locator(".scene canvas")).toHaveAttribute("data-ready", "true");
  await page.locator(".scene").scrollIntoViewIfNeeded();
  return errors;
}

const draws = (page: Page) => page.evaluate(() => (globalThis as any).__draws ?? 0);
async function expectStopped(page: Page) {
  await page.waitForTimeout(200);
  const before = await draws(page);
  await page.waitForTimeout(300);
  expect(await draws(page)).toBe(before);
  return before;
}

test("offscreen previews and hidden play stop rendering, then resume without retained input", async ({ page }) => {
  const errors = await open(page);
  const before = await draws(page);
  await expect.poll(() => draws(page)).toBeGreaterThan(before + 1);
  await page.locator(".scene").evaluate(el => { (el as HTMLElement).style.transform = "translateY(200vh)"; });
  const stopped = await expectStopped(page);
  await page.locator(".scene").evaluate(el => { (el as HTMLElement).style.transform = ""; });
  await expect.poll(() => draws(page)).toBeGreaterThan(stopped + 1);
  await page.getByRole("button", { name: "플레이", exact: true }).click();
  const canvas = page.locator(".play-shell canvas");
  await expect(canvas).toHaveAttribute("data-ready", "true");
  const z = () => page.evaluate(() => (globalThis as any).__performancePlayer.z as number);
  await expect(canvas).toHaveAttribute("data-player-z", /.+/);
  const initial = await z();
  await page.keyboard.down("w");
  await expect.poll(z).toBeLessThan(initial - .05);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const hidden = await expectStopped(page);
  const position = await z();
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => draws(page)).toBeGreaterThan(hidden + 2);
  expect(await z()).toBeCloseTo(position, 3);
  await page.keyboard.up("w");
  expect(errors).toEqual([]);
});

test("artwork is reused for unrelated edits and refreshes after image replacement and undo", async ({ page }) => {
  const errors = await open(page, true);
  const picture = () => page.evaluate(() => {
    const mesh = (globalThis as any).__performanceScene.getObjectByName("symbol-content");
    return { id: mesh?.parent.uuid, image: mesh?.material.map?.image?.src };
  });
  await expect.poll(async () => (await picture()).image).toMatch(/^data:image/);
  const initial = await picture();
  await page.getByRole("button", { name: "높이기", exact: true }).click();
  await page.locator('[data-cell="0"]').click({position: {x: 2, y: 2}});
  await expect(page.locator('[data-cell="0"]')).toHaveAccessibleName(/높이 1/);
  const beforeEdit = await draws(page);
  await page.locator(".scene").scrollIntoViewIfNeeded();
  await expect.poll(() => draws(page)).toBeGreaterThan(beforeEdit);
  expect(await picture()).toEqual(initial);
  await openPlaced(page, "perf-art");
  const replacement = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 32;
    const context = canvas.getContext("2d")!; context.fillStyle = "blue"; context.fillRect(0, 0, 32, 32);
    return canvas.toDataURL();
  });
  await page.getByRole("dialog").locator('input[type="file"]').setInputFiles({ name: "blue.png", mimeType: "image/png", buffer: Buffer.from(replacement.split(",")[1], "base64") });
  await page.getByRole("dialog").getByRole("button", { name: "저장", exact: true }).click();
  await page.locator(".scene").scrollIntoViewIfNeeded();
  await expect.poll(async () => (await picture()).image).not.toBe(initial.image);
  expect((await picture()).id).not.toBe(initial.id);
  await page.getByRole("button", { name: "되돌리기", exact: true }).click();
  await page.locator(".scene").scrollIntoViewIfNeeded();
  await expect.poll(async () => (await picture()).image).toBe(initial.image);
  expect(errors).toEqual([]);
});

test("artwork ground height follows terrain edits, actor movement, water and undo", async ({ page }) => {
  const errors = await open(page, true);
  const position = () => page.evaluate(() => {
    const model = (globalThis as any).__performanceScene.getObjectByName("symbol-content").parent;
    return { id: model.uuid, x: model.position.x, y: model.position.y };
  });
  const initial = await position();
  expect(initial.y).toBe(0);
  await page.getByRole("button", { name: "높이기", exact: true }).click();
  await page.locator('[data-cell="78"]').click({ position: { x: 2, y: 2 } });
  await page.locator(".scene").scrollIntoViewIfNeeded();
  await expect.poll(async () => (await position()).y).toBeGreaterThan(1);
  expect((await position()).id).toBe(initial.id);
  await page.evaluate(() => {
    const actors = (globalThis as any).__performanceActors;
    actors.current = actors.current.map((actor: any) => ({ ...actor, x: 4 }));
  });
  await expect.poll(async () => (await position()).x).toBe(initial.x - 4);
  await expect.poll(async () => (await position()).y).toBe(0);
  await page.getByRole("button", { name: "되돌리기", exact: true }).click();
  await page.locator(".scene").scrollIntoViewIfNeeded();
  await expect.poll(position).toEqual(initial);
  await page.getByRole("button", { name: "흐름", exact: true }).click();
  await page.locator('[data-cell="78"]').click({ position: { x: 2, y: 2 } });
  await page.locator(".scene").scrollIntoViewIfNeeded();
  await expect.poll(async () => (await position()).y).toBeLessThan(-.02);
  const heights: number[] = [];
  for (let i = 0; i < 6; i++) {
    heights.push((await position()).y);
    await page.waitForTimeout(100);
  }
  expect(Math.min(...heights)).toBeGreaterThan(-.1);
  expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(.0001);
  await page.getByRole("button", { name: "되돌리기", exact: true }).click();
  await page.locator(".scene").scrollIntoViewIfNeeded();
  await expect.poll(position).toEqual(initial);
  expect(errors).toEqual([]);
});

test("cached water reflections avoid unrelated matrix updates and follow camera and terrain changes", async ({ page }) => {
  await page.route("**/reflection-test", route => route.fulfill({ contentType: "text/html", body: "<html></html>" }));
  await page.goto("reflection-test");
  const result = await page.evaluate(async () => {
    const root = "/whistle/";
    const THREE = await import(root + "node_modules/three/build/three.module.js");
    const { makeWaterReflection } = await import(root + "components/whistle/WaterReflection.ts");
    const { createPeerTrailLine } = await import(root + "components/whistle/PeerTrailLine.ts");
    const renderer = new THREE.WebGLRenderer(), scene = new THREE.Scene(), terrain = new THREE.Group();
    scene.add(terrain);
    const { line } = createPeerTrailLine();
    scene.add(line); line.visible = true;
    const trailInReflections: boolean[] = [];
    const unrelated = new THREE.Object3D(); terrain.add(unrelated);
    let updates = 0, draws = 0;
    const update = unrelated.updateMatrixWorld.bind(unrelated), render = renderer.render.bind(renderer);
    unrelated.updateMatrixWorld = (force: boolean) => { updates++; update(force); };
    renderer.render = (...args: any[]) => { draws++; trailInReflections.push(line.visible); render(...args); };
    const water = (x: number, level: number) => {
      const material = new THREE.ShaderMaterial({ uniforms: { hasReflection: { value: 0 }, reflectionMap: { value: null }, reflectionMatrix: { value: new THREE.Matrix4() } } });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), material);
      mesh.name = "generated-water"; mesh.userData.waterLevel = level; mesh.position.set(x, level, 0); terrain.add(mesh);
      return mesh;
    };
    const low = water(0, 0), high = water(10, 2);
    const camera = new THREE.OrthographicCamera(-2, 2, 2, -2, .1, 20); camera.up.set(0, 0, -1);
    const look = (x: number) => { camera.position.set(x, 5, 0); camera.lookAt(x, 0, 0); };
    const reflection = makeWaterReflection();
    look(0); reflection.update(renderer, scene, camera, terrain, 0);
    const initial = { draws, updates, low: low.material.uniforms.hasReflection.value };
    reflection.update(renderer, scene, camera, terrain, 50);
    const cached = { draws, updates };
    look(10); reflection.update(renderer, scene, camera, terrain, 60);
    const selected = { draws, low: low.material.uniforms.hasReflection.value, high: high.material.uniforms.hasReflection.value };
    const matrix = high.material.uniforms.reflectionMatrix.value.toArray();
    terrain.position.x = 5;
    reflection.update(renderer, scene, camera, terrain, 80);
    const outside = [low.material.uniforms.hasReflection.value, high.material.uniforms.hasReflection.value];
    look(15); reflection.update(renderer, scene, camera, terrain, 200);
    const moved = { draws, high: high.material.uniforms.hasReflection.value, matrix: high.material.uniforms.reflectionMatrix.value.toArray() };
    const error = renderer.getContext().getError();
    for (const mesh of [low, high, line]) { mesh.geometry.dispose(); mesh.material.dispose(); }
    reflection.dispose(); renderer.dispose();
    return { initial, cached, selected, outside, matrix, moved, error, trailInReflections, trailVisible: line.visible };
  });
  expect(result.initial.draws).toBe(1);
  expect(result.initial.low).toBe(1);
  expect(result.cached).toEqual({ draws: 1, updates: result.initial.updates });
  expect(result.selected).toEqual({ draws: 2, low: 0, high: 1 });
  expect(result.outside).toEqual([0, 0]);
  expect(result.moved.draws).toBe(3);
  expect(result.moved.high).toBe(1);
  expect(result.moved.matrix).not.toEqual(result.matrix);
  expect(result.trailInReflections).toEqual([false, false, false]);
  expect(result.trailVisible).toBe(true);
  expect(result.error).toBe(0);
});
