import { test, expect, type Page } from "@playwright/test";
import { createMeetingWorld } from "../../lib/meeting";
import { probePd, pdMessages } from "./pd-probe";
import type { Weather, TimeOfDay } from "../../lib/world";

test.setTimeout(90_000);
test.use({ viewport: { width: 800, height: 600 } });

async function open(page: Page, timeOfDay: TimeOfDay = "midnight", weather: Weather = "clear", room = `meteors-${Date.now()}`) {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error" || /couldn't create|connection failed|no such object/.test(message.text())) errors.push(message.text());
  });
  await probePd(page);
  await page.route(/\/components\/whistle\/Scene\.tsx(\?|$)/, async route => {
    const response = await route.fetch();
    const body = (await response.text()).replace("scene.add(meteorScene.mesh);", "scene.add(meteorScene.mesh); globalThis.__meteorMesh = meteorScene.mesh;")
      .replace("const portalScene = createPortalScene(world.size);", "globalThis.__meteorWorld = worldRef; const portalScene = createPortalScene(world.size);")
      .replace("meteorScene.update(showerElapsed, showerSeed, camera, reducedMotion);", `
        meteorScene.update(showerElapsed, showerSeed, camera, reducedMotion);
        if (mode === "play") globalThis.__meteorFrame = { elapsed: showerElapsed, seed: showerSeed, eligible, startsAt: timeline.startsAt };
      `);
    await route.fulfill({ response, body });
  });
  const world = createMeetingWorld(17);
  world.timeOfDay = timeOfDay; world.weather = weather;
  await page.addInitScript(world => {
    Object.defineProperty(window, "devicePixelRatio", { value: .75 });
    localStorage.setItem("whistle.language", "ko");
    localStorage.setItem("whistle.world.v2", JSON.stringify(world));
  }, world);
  await page.goto(`?meeting=${room}&debug`);
  await expect(page.locator(".live-preview canvas")).toHaveAttribute("data-ready", "true");
  await page.getByRole("button", { name: "플레이", exact: true }).click();
  await expect(page.locator(".play-shell canvas")).toHaveAttribute("data-ready", "true");
  await expect.poll(async () => (await pdMessages(page, "whistle-player position")).length, { timeout: 30_000 }).toBeGreaterThan(0);
  return errors;
}
const frame = (page: Page) => page.evaluate(() => (globalThis as any).__meteorFrame as {elapsed: number | null; seed: number; eligible: boolean; startsAt: number | null});
const meteorMessages = (page: Page) => pdMessages(page, "whistle-event fallingstar");

test("night meteor graphics and Daban sound start together, end together, and stop in rain", async ({ page }, info) => {
  const errors = await open(page);
  expect((await frame(page)).elapsed).toBeNull();
  await page.mouse.move(600, 450); await page.mouse.down();
  await page.mouse.move(600, 100, { steps: 12 }); await page.mouse.up();
  await page.keyboard.press("Digit1");
  await expect.poll(async () => (await frame(page)).elapsed).not.toBeNull();
  await expect.poll(async () => (await meteorMessages(page)).at(-1)).toEqual([1]);
  await expect.poll(() => page.evaluate(() => (globalThis as any).__meteorMesh.geometry.drawRange.count)).toBeGreaterThan(0);
  await expect.poll(async () => (await frame(page)).elapsed).toBeGreaterThan(.75);
  await page.screenshot({ path: info.outputPath("meteor-night.png") });
  await expect.poll(async () => (await frame(page)).elapsed, { timeout: 16_000 }).toBeNull();
  await expect.poll(async () => (await meteorMessages(page)).at(-1)).toEqual([0]);
  expect((await meteorMessages(page)).filter(message => message[0] === 1)).toHaveLength(1);
  await page.keyboard.press("Digit1");
  await expect.poll(async () => (await frame(page)).elapsed).not.toBeNull();
  await page.evaluate(() => { (globalThis as any).__meteorWorld.current.weather = "rain"; });
  await expect.poll(async () => (await frame(page)).elapsed).toBeNull();
  await expect.poll(async () => (await meteorMessages(page)).at(-1)).toEqual([0]);
  await page.keyboard.press("Digit1");
  await page.waitForTimeout(400);
  expect((await frame(page)).elapsed).toBeNull();
  expect(errors).toEqual([]);
});

test("daytime blocks the preview, and exiting a night preview turns its sound off", async ({ page }) => {
  const errors = await open(page, "noon");
  await page.keyboard.press("Digit1");
  await page.waitForTimeout(500);
  expect((await frame(page)).elapsed).toBeNull();
  expect((await meteorMessages(page)).some(message => message[0] === 1)).toBe(false);
  await page.evaluate(() => { (globalThis as any).__meteorWorld.current.timeOfDay = "midnight"; });
  await expect.poll(async () => (await frame(page)).eligible, { timeout: 10_000 }).toBe(true);
  await page.keyboard.press("Digit1");
  await expect.poll(async () => (await meteorMessages(page)).at(-1)).toEqual([1]);
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await meteorMessages(page)).at(-1)).toEqual([0]);
  expect(errors).toEqual([]);
});

test("two browsers receive the same scheduled shower and one leaving does not reset it", async ({ browser, baseURL }) => {
  const ca = await browser.newContext({baseURL, viewport:{width:640,height:480}});
  const cb = await browser.newContext({baseURL, viewport:{width:390,height:844}});
  try {
    const a = await ca.newPage(), b = await cb.newPage(), room = `meteor-shared-${Date.now()}`;
    const errorsA = await open(a, "midnight", "clear", room);
    await expect.poll(async () => (await frame(a)).startsAt).not.toBeNull();
    const scheduled = (await frame(a)).startsAt!;
    const remaining = scheduled - Date.now();
    expect(remaining).toBeGreaterThan(50_000); expect(remaining).toBeLessThanOrEqual(180_000);
    const errorsB = await open(b, "midnight", "clear", room);
    await expect.poll(async () => (await frame(b)).startsAt).toBe(scheduled);
    expect((await frame(a)).seed).toBe((await frame(b)).seed);
    await a.close();
    await expect(b.locator(".presence-number")).toHaveText("1");
    expect((await frame(b)).startsAt).toBe(scheduled);
    expect([...errorsA, ...errorsB]).toEqual([]);
  } finally { await ca.close(); await cb.close(); }
});

test("the imported meteor patch produces audio and becomes silent after switching off", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", message => { if (message.type() === "error" || /couldn't create|connection failed/.test(message.text())) errors.push(message.text()); });
  await page.route("**/meteor-audio-test", route => route.fulfill({
    contentType: "text/html", headers: { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" },
    body: `<button id="start">Start</button><script type="module">
      import { openEngine } from '/whistle/lib/audio/pd-runtime.ts';
      document.querySelector('button').onclick = async () => {
        const engine = await openEngine('/whistle/audio/');
        await engine.context.resume();
        const patch = await engine.start('event');
        const analyser = engine.context.createAnalyser(); analyser.fftSize = 2048;
        patch.node.connect(analyser); analyser.connect(engine.context.destination);
        window.meteorPatch = patch;
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
  await page.evaluate(() => (window as any).meteorPatch.send("whistle-event", [440, .1, 0]));
  await expect.poll(() => page.evaluate(() => (window as any).rms())).toBeGreaterThan(.001);
  expect(errors).toEqual([]);
});
