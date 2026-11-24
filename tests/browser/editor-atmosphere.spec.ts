import { savedWorld } from "./world-storage";
import { test, expect, type Page } from "@playwright/test";
import { terrainFixtures } from "../terrain-fixtures";

test.setTimeout(60_000);
test.beforeEach(async({page})=>{
  await page.addInitScript(()=>Object.defineProperty(window,"devicePixelRatio",{value:.5}));
});

async function setup(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.route(/\/components\/whistle\/Scene\.tsx(\?|$)/, async route => {
    const response = await route.fetch();
    const source = (await response.text())
      .replace("const scene = new THREE.Scene();", "const scene = new THREE.Scene(); globalThis.__testScene = scene;")
      .replace("if (previewOrbit) {", "globalThis.__testOrbit = previewOrbit; globalThis.__testCamera = camera; if (previewOrbit) {");
    await route.fulfill({ response, body: source });
  });
  await page.addInitScript(world => {
    if (localStorage.getItem("atmosphere-ready")) return;
    localStorage.setItem("atmosphere-ready", "1");
    localStorage.setItem("whistle.world.v2", JSON.stringify(world));
    localStorage.setItem("whistle.language", "ko");
  }, terrainFixtures().mixed);
  await page.goto(".");
  await page.locator('.live-preview canvas').scrollIntoViewIfNeeded();
  await expect(page.locator('.live-preview canvas')).toHaveAttribute('data-ready','true',{timeout:30_000});
  await expect.poll(() => page.evaluate(() => !!(globalThis as any).__testOrbit)).toBe(true);
  return errors;
}

test("automatic daylight follows local time and its menu opens without changing the world", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.install({ time: new Date(2026, 10, 17, 12) });
  const errors = await setup(page);
  const indicator = page.locator(".daylight-indicator");
  await expect(indicator).toHaveAttribute("data-time-of-day", "day");
  await expect(indicator).toHaveAccessibleName(/현재 낮/);
  await expect.poll(() => page.evaluate(() => (globalThis as any).__testScene.background.r)).toBeGreaterThan(.3);
  expect(await indicator.evaluate(el => el.tagName)).toBe("BUTTON");
  expect(await indicator.evaluate(el => (el as HTMLElement).tabIndex)).toBe(0);
  await expect(page.locator('.palette-weather button')).toHaveCount(3);
  const before = JSON.stringify(await savedWorld(page));
  await indicator.click();
  await expect(page.getByRole("button", { name: "현재 시간", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(indicator).toBeFocused();
  expect(JSON.stringify(await savedWorld(page))).toBe(before);
  await page.clock.setSystemTime(new Date(2026, 10, 17, 23));
  await page.clock.fastForward(30_000);
  await expect(indicator).toHaveAttribute("data-time-of-day", "night");
  await expect(indicator).toHaveAccessibleName(/현재 밤/);
  await expect.poll(() => page.evaluate(() => (globalThis as any).__testScene.background.r), { timeout: 30_000 }).toBeLessThan(.01);
  await page.screenshot({ path: testInfo.outputPath("night-indicator.png") });
  expect(errors).toEqual([]);
});

for (const mobile of [false, true]) test(`preview rotates without editing the board: ${mobile ? "touch" : "mouse"}`, async ({ page }, testInfo) => {
  if (mobile) await page.setViewportSize({ width: 390, height: 844 });
  const errors = await setup(page);
  const canvas = page.locator(".live-preview canvas");
  await canvas.scrollIntoViewIfNeeded();
  const beforeWorld=JSON.stringify(await savedWorld(page));
  const before = await page.evaluate(() => ({ camera: (globalThis as any).__testCamera.position.toArray() }));
  const box = (await canvas.boundingBox())!;
  if (mobile) {
    const session = await page.context().newCDPSession(page);
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x + box.width * .25, y: box.y + box.height * .5 }] });
    for (let i = 1; i <= 8; i++) await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: box.x + box.width * (.25 + i * .055), y: box.y + box.height * (.5 + i * .01) }] });
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await session.detach();
  } else {
    await page.mouse.move(box.x + box.width * .25, box.y + box.height * .5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * .75, box.y + box.height * .6, { steps: 12 });
    await page.mouse.up();
  }
  await expect.poll(() => page.evaluate(() => (globalThis as any).__testCamera.position.x)).not.toBe(before.camera[0]);
  await expect(canvas).not.toHaveAttribute("data-dragging", "true");
  expect(JSON.stringify(await savedWorld(page))).toBe(beforeWorld);
  await expect(page.getByRole("button", { name: "되돌리기", exact: true })).toBeDisabled();
  if (!mobile) {
    const x = await page.evaluate(() => (globalThis as any).__testCamera.position.x);
    await canvas.focus(); await page.keyboard.press("ArrowLeft");
    await expect.poll(() => page.evaluate(() => (globalThis as any).__testCamera.position.x)).not.toBe(x);
  }
  await canvas.screenshot({ path: testInfo.outputPath("rotated-preview.png") });
  await page.getByRole("button", { name: "들어가기", exact: true }).click();
  await expect(page.locator(".play-shell canvas")).toBeVisible();
  expect(errors).toEqual([]);
});

test("branch silhouettes retain tapered limbs, bark and closed ends", async ({ page }, testInfo) => {
  await page.clock.setFixedTime(new Date(2026, 10, 17, 12));
  const errors = await setup(page);
  await page.evaluate(() => {
    const scene = (globalThis as any).__testScene, camera = (globalThis as any).__testCamera, orbit = (globalThis as any).__testOrbit;
    const tree = scene.getObjectByName("generated-trunks");
    scene.fog = null;
    scene.traverse((object: any) => { if (object.isMesh && object !== tree) object.visible = false; });
    const center = tree.geometry.boundingBox.getCenter(tree.position.clone()).add(tree.position);
    orbit.target.copy(center); camera.position.set(center.x + 6, center.y + 1, center.z + 10);
    camera.zoom = 4; camera.updateProjectionMatrix(); orbit.update();
  });
  await page.locator(".live-preview canvas").screenshot({ path: testInfo.outputPath("tree-closeup.png") });
  await page.locator(".daylight-indicator").click();
  await page.getByRole("button",{name:"한밤중",exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(globalThis as any).__testScene.getObjectByName("whistle-sun").intensity)).toBeLessThan(.02);
  await expect.poll(()=>page.locator(".live-preview canvas").evaluate(canvas=>new Promise<number>(resolve=>{
    requestAnimationFrame(()=>{
      const source=canvas as HTMLCanvasElement,copy=document.createElement("canvas");
      copy.width=source.width;copy.height=source.height;
      const context=copy.getContext("2d")!;context.drawImage(source,0,0);
      const pixels=context.getImageData(0,0,copy.width,copy.height).data;
      let visible=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]>35)visible++;
      resolve(visible);
    });
  }))).toBeGreaterThan(50);
  await page.locator(".live-preview canvas").screenshot({path:testInfo.outputPath("tree-night.png")});
  expect(errors).toEqual([]);
});


test("time overrides update lighting and water, survive reload and play, and return to local time", async ({ page }, testInfo) => {
  await page.emulateMedia({reducedMotion:"reduce"});
  await page.clock.setFixedTime(new Date(2026, 10, 17, 15));
  const errors = await setup(page);
  const indicator = page.locator(".daylight-indicator");
  const choose = async (label: string) => { await indicator.click(); await page.getByRole("button", { name: label, exact: true }).click(); };
  const sunlight = () => page.evaluate(() => (globalThis as any).__testScene?.getObjectByName("whistle-sun")?.intensity);
  await page.evaluate(() => { (globalThis as any).__terrainBefore = (globalThis as any).__testScene.getObjectByName("continuous-ground"); });
  await page.getByRole("button", { name: "비", exact: true }).click();
  await choose("한밤중");
  await expect.poll(sunlight).toBeLessThan(.02);
  await expect(indicator).toHaveAttribute("data-time-mode", "midnight");
  await expect(page.getByRole("button", { name: "비", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => (globalThis as any).__terrainBefore === (globalThis as any).__testScene.getObjectByName("continuous-ground"))).toBe(true);
  await expect.poll(() => page.evaluate(() => (globalThis as any).__testScene.getObjectByName("generated-water").material.uniforms.lightPower.value)).toBeCloseTo(.66, 2);
  await expect.poll(async () => (await savedWorld(page)).timeOfDay).toBe("midnight");
  await page.reload();
  await expect(indicator).toHaveAttribute("data-time-mode", "midnight");
  await expect.poll(sunlight).toBeLessThan(.02);
  await page.getByRole("button", { name: "플레이", exact: true }).click();
  await expect(page.locator(".play-shell canvas")).toBeVisible();
  await expect.poll(sunlight).toBeLessThan(.02);
  await page.getByRole("button", { name: "만들기로 돌아가기", exact: true }).click();
  await choose("한낮");
  await expect.poll(sunlight).toBeGreaterThan(.28);
  await expect(indicator).toHaveAttribute("data-time-of-day", "day");
  await choose("현재 시간");
  await expect.poll(async () => (await savedWorld(page)).timeOfDay).toBe("auto");
  await expect(indicator).toHaveAccessibleName(/15:00/);
  await page.setViewportSize({ width: 390, height: 844 });
  await indicator.click();
  await page.screenshot({ path: testInfo.outputPath("time-options-mobile.png") });
  const bounds = (await page.locator(".daylight-options").boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await page.getByRole("button", { name: "한밤중", exact: true }).click();
  await expect(indicator).toHaveAttribute("data-time-mode", "midnight");
  await page.getByRole("button", { name: "되돌리기", exact: true }).click();
  await expect(indicator).toHaveAttribute("data-time-mode", "auto");
  expect(errors).toEqual([]);
});
