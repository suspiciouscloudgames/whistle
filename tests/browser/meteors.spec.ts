import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { createMeetingWorld } from "../../lib/meeting";
import { flatTerrain } from "../../lib/terrain";
import { probePd, pdMessages } from "./pd-probe";
import type { Weather, TimeOfDay } from "../../lib/world";

test.setTimeout(90_000);
test.use({ viewport: { width: 800, height: 600 } });

async function open(page: Page, timeOfDay: TimeOfDay = "midnight", weather: Weather = "clear", room = `meteors-${Date.now()}`, debug = true, world = createMeetingWorld(17)) {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error" || /couldn't create|connection failed|no such object/.test(message.text())) errors.push(message.text());
  });
  await probePd(page);
  await page.route(/\/components\/whistle\/Scene\.tsx(\?|$)/, async route => {
    const response = await route.fetch();
    const body = (await response.text()).replace("scene.add(meteorScene.group);", "scene.add(meteorScene.group); globalThis.__meteorGroup = meteorScene.group;")
      .replace("const portalScene = createPortalScene(world.size);", "globalThis.__meteorWorld = worldRef; const portalScene = createPortalScene(world.size);")
      .replace("pixelRenderer.render(scene, camera);", `$&
        globalThis.__meteorPlayScene = scene;
        if (mode === "play") {
          const active = visibleShowers[0];
          const showerElapsed = active ? (time - active.startedAt) / 1000 : null;
          globalThis.__meteorFrame = { elapsed: showerElapsed, count: active?.streaks.length ?? 0, showers: visibleShowers.length };
          if (active) globalThis.__sawShower = true;
          if (active && showerElapsed >= active.streaks[0].duration * .25 && showerElapsed <= active.streaks[0].duration * .7) {
            globalThis.__captureMeteor?.(renderer.domElement);
          }
        }`);
    await route.fulfill({ response, body });
  });
  world.timeOfDay = timeOfDay; world.weather = weather;
  await page.addInitScript(world => {
    Object.defineProperty(window, "devicePixelRatio", { value: .75 });
    localStorage.setItem("whistle.language", "ko");
    localStorage.setItem("whistle.world.v2", JSON.stringify(world));
  }, world);
  await page.goto(`?meeting=${room}${debug ? "&debug" : ""}`);
  await expect(page.locator(".live-preview canvas")).toHaveAttribute("data-ready", "true");
  await page.getByRole("button", { name: "플레이", exact: true }).click();
  await expect(page.locator(".play-shell canvas")).toHaveAttribute("data-ready", "true");
  await expect.poll(async () => (await pdMessages(page, "whistle-player position")).length, { timeout: 30_000 }).toBeGreaterThan(0);
  return errors;
}
const frame = (page: Page) => page.evaluate(() => (globalThis as any).__meteorFrame as {elapsed: number | null; count: number; showers: number});
const meteorMessages = (page: Page) => pdMessages(page, "whistle-event fallingstar");

for (const kind of ["text", "image"] as const) test(`walking past authored ${kind} reveals at a distance, fades before crossing and reappears on return`, async ({ page }) => {
  const world = createMeetingWorld(17);
  world.terrain = flatTerrain(world.size);
  const title = world.assets.find(a => a.prompt?.title)!;
  title.placement = kind === "text" ? "floating" : "upright";
  if (kind === "text") Object.assign(title, { text: "여기, 지금", textColor: "#209047" });
  else {
    delete title.text;
    title.image = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 128;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#209047";
      ctx.fillRect(20, 20, 88, 88);
      return canvas.toDataURL();
    });
  }
  const first = world.objects.find(o => o.asset === title.id)!;
  Object.assign(first, { id: "pass-first", x: world.start.x, z: world.start.z - 5 });
  world.objects.push({ ...first, id: "pass-copy", x: world.start.x + 2 });
  world.assets.push({ ...title, id: "fixed-art", prompt: undefined, placement: kind === "text" ? "surface" : "field" });
  world.objects.push({ ...first, id: "attached-copy", asset: "fixed-art", x: world.start.x + 1 });
  const errors = await open(page, "noon", kind === "image" ? "rain" : "clear", undefined, false, world);
  const attachedOpacity = () => page.evaluate(() => {
    const model = (globalThis as any).__meteorPlayScene?.children.find((o: any) => o.userData.placementId?.endsWith("attached-copy"));
    return model?.getObjectByName("surface-image")?.material.opacity;
  });
  const opacity = (id: string) => page.evaluate(id => {
    const model = (globalThis as any).__meteorPlayScene?.children.find((o: any) => o.userData.placementId?.endsWith(id));
    return model?.getObjectByName("symbol-content")?.material.opacity as number | undefined;
  }, id);
  await expect.poll(() => opacity("pass-first")).toBe(1);
  const textPose = () => page.evaluate(() => {
    const model = (globalThis as any).__meteorPlayScene.children.find((o: any) => o.userData.placementId?.endsWith("pass-first"));
    return model.getObjectByName("symbol-content").matrixWorld.toArray();
  });
  const initialPose = kind === "text" ? await textPose() : undefined;
  await expect.poll(attachedOpacity).toBe(1);
  expect((await frame(page)).elapsed).toBeNull();
  const playerZ = async () => Number(await page.locator(".play-shell canvas").getAttribute("data-player-z"));
  const moveUntil = async (key: string, arrived: () => Promise<boolean>) => {
    await page.keyboard.down(key);
    try { await expect.poll(arrived, { timeout: 15000, intervals: [50] }).toBe(true); }
    finally { await page.keyboard.up(key); }
  };
  await moveUntil("w", async () => await playerZ() < first.z + 1.45);
  expect((await frame(page)).count).toBe(0);
  await expect.poll(async () => (await opacity("pass-first")) ?? 1).toBeLessThan(.98);
  expect(await playerZ()).toBeGreaterThan(first.z);
  await moveUntil("w", async () => (await frame(page)).count > 0);
  expect((await frame(page)).showers).toBe(1);
  expect((await frame(page)).count).toBeLessThanOrEqual(3);
  await expect.poll(async () => (await meteorMessages(page)).at(-1)).toEqual([1]);
  await expect.poll(() => opacity("pass-first")).toBe(0);
  if (initialPose) expect(await textPose()).toEqual(initialPose);
  expect(await attachedOpacity()).toBe(1);
  expect(await opacity("pass-copy")).toBe(1);
  await moveUntil("w", async () => await playerZ() < first.z - 4.5);
  await expect.poll(async () => (await frame(page)).elapsed, {timeout: 16_000}).toBeNull();
  expect(await attachedOpacity()).toBe(1);
  await moveUntil("s", async () => await playerZ() > first.z - 2.7);
  await expect.poll(() => opacity("pass-first")).toBe(1);
  if (initialPose) expect(await textPose()).toEqual(initialPose);
  expect((await frame(page)).count).toBe(0);
  await moveUntil("s", async () => (await frame(page)).count > 0);
  expect(errors).toEqual([]);
});

async function lookAtShower(page: Page) {
  await page.mouse.move(680, 470); await page.mouse.down();
  await page.mouse.move(455, 40, { steps: 14 }); await page.mouse.up();
  await expect.poll(async () => Number(await page.locator(".play-shell canvas").getAttribute("data-player-yaw"))).toBeLessThan(-.4);
  await page.evaluate(() => {
    (globalThis as any).__captureMeteor = (source: HTMLCanvasElement) => {
      const copy = document.createElement("canvas");
      copy.width = source.width; copy.height = source.height;
      const ctx = copy.getContext("2d")!;
      ctx.drawImage(source, 0, 0);
      const pixels = ctx.getImageData(0, 0, copy.width, Math.floor(copy.height / 2)).data;
      let red = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] > pixels[i + 1] + 18 && pixels[i] > pixels[i + 2] + 18) red++;
      }
      (globalThis as any).__meteorImage = { red, png: copy.toDataURL() };
      delete (globalThis as any).__captureMeteor;
    };
  });
}

async function checkRedTrail(page: Page, info: TestInfo, name: string) {
  await expect.poll(() => page.evaluate(() => (globalThis as any).__meteorImage?.red ?? 0)).toBeGreaterThan(20);
  const png = await page.evaluate(() => (globalThis as any).__meteorImage.png as string);
  await writeFile(info.outputPath(name + ".png"), Buffer.from(png.split(",")[1], "base64"));
}

test("night meteor graphics and Daban sound start together, end together, and stop in rain", async ({ page }, info) => {
  const errors = await open(page);
  expect((await frame(page)).elapsed).toBeNull();
  await lookAtShower(page);
  await page.keyboard.press("Digit1");
  await expect.poll(async () => (await frame(page)).elapsed).not.toBeNull();
  await expect.poll(async () => (await meteorMessages(page)).at(-1)).toEqual([1]);
  await expect.poll(() => page.evaluate(() => (globalThis as any).__meteorGroup.children[0]?.geometry.drawRange.count ?? 0)).toBeGreaterThan(0);
  await checkRedTrail(page, info, "meteor-night");
  await expect.poll(async () => (await frame(page)).elapsed, { timeout: 16_000 }).toBeNull();
  await expect.poll(async () => (await meteorMessages(page)).at(-1)).toEqual([0]);
  expect((await meteorMessages(page)).filter(message => message[0] === 1)).toHaveLength(1);
  await page.keyboard.press("Digit1");
  await expect.poll(async () => (await frame(page)).elapsed).not.toBeNull();
  await page.evaluate(() => { (globalThis as any).__meteorWorld.current.weather = "rain"; });
  await expect.poll(async () => (await frame(page)).elapsed).toBeNull();
  await expect.poll(async () => (await meteorMessages(page)).at(-1)).toEqual([0]);
  await page.keyboard.press("Digit1");
  await expect.poll(async () => (await meteorMessages(page)).at(-1)).toEqual([1]);
  expect((await frame(page)).elapsed).toBeNull();
  await page.getByRole("button", {name: "유성우 테스트 (1)"}).click();
  await expect.poll(async () => (await meteorMessages(page)).at(-1)).toEqual([0]);
  expect(errors).toEqual([]);
});

test("the debug shortcut shows the daylight shower with audio and stops on exit", async ({ page }, info) => {
  const errors = await open(page, "noon", "clear", undefined, false);
  const overlay = page.locator(".play-shell pre");
  await page.keyboard.press("Digit1");
  await page.keyboard.press("Backquote");
  await expect(overlay).toContainText("fallingstar 0");
  expect((await meteorMessages(page)).some(message => message[0] === 1)).toBe(false);
  await lookAtShower(page);
  await page.keyboard.press("Digit1");
  await expect.poll(async () => (await meteorMessages(page)).at(-1)).toEqual([1]);
  await expect(overlay).toContainText("fallingstar 1");
  expect((await frame(page)).elapsed).not.toBeNull();
  await checkRedTrail(page, info, "meteor-day");
  await page.keyboard.press("Digit1");
  await expect.poll(async () => (await meteorMessages(page)).at(-1)).toEqual([0]);
  await page.keyboard.press("Numpad1");
  await expect.poll(async () => (await meteorMessages(page)).at(-1)).toEqual([1]);
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await meteorMessages(page)).at(-1)).toEqual([0]);
  expect(errors).toEqual([]);
});

test("waiting in an online world never starts an ambient shower", async ({ page }) => {
  const errors = await open(page, "midnight", "clear", undefined, false);
  await page.clock.install();
  for (let i = 0; i < 40; i++) await page.clock.fastForward(5000);
  expect((await frame(page)).count).toBe(0);
  expect(await page.evaluate(() => !!(globalThis as any).__sawShower)).toBe(false);
  expect((await meteorMessages(page)).some(message => message[0] === 1)).toBe(false);
  expect(errors).toEqual([]);
});

test("the imported meteor patch produces audio and becomes silent after switching off", async ({ page }) => {
  await page.context().grantPermissions(["local-network-access"]);
  const errors: string[] = [];
  page.on("console", message => { if (message.type() === "error" || /couldn't create|connection failed/.test(message.text())) errors.push(message.text()); });
  await page.route("**/meteor-audio-test", route => route.fulfill({
    contentType: "text/html", headers: { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" },
    body: `<button id="start">Start</button><script type="module">
      import { openEngine } from '/whistle/lib/audio/pd-runtime.ts';
      document.querySelector('button').onclick = async () => {
        const engine = await openEngine('/whistle/audio/');
        await engine.context.resume();
        const analyser = engine.context.createAnalyser(); analyser.fftSize = 2048;
        engine.mixdown.connect(analyser); analyser.connect(engine.context.destination);
        window.meteorPatch = engine;
        window.rms = () => { const a = new Float32Array(2048); analyser.getFloatTimeDomainData(a); return Math.sqrt(a.reduce((sum, n) => sum + n*n, 0)/a.length); };
      };
    </script>`,
  }));
  await page.goto("meteor-audio-test");
  await page.getByRole("button", { name: "Start" }).click();
  await expect.poll(() => page.evaluate(() => !!(window as any).meteorPatch), { timeout: 30_000 }).toBe(true);
  await page.evaluate(() => (window as any).meteorPatch.send("whistle-event", ["fallingstar", 1]));
  await expect.poll(() => page.evaluate(() => (window as any).rms()), { timeout: 10_000 }).toBeGreaterThan(.0001);
  await page.evaluate(() => (window as any).meteorPatch.send("whistle-event", ["fallingstar", 0]));
  await expect.poll(() => page.evaluate(() => (window as any).rms()), { timeout: 5000 }).toBeLessThan(.000001);
  expect(errors).toEqual([]);
});
