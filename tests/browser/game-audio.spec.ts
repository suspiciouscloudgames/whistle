import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { terrainFixtures } from "../terrain-fixtures";
import type { World } from "../../lib/world";

test.setTimeout(90_000);
type Probe = {
  messages: { bus: string; value: (string | number)[] }[];
  contexts: AudioContext[]; rms: number; peak: number;
};
async function openWorld(page: Page, world: World) {
  const io = JSON.parse(readFileSync("public/audio-test/io.json", "utf8"));
  await page.addInitScript(({ world, io }) => {
    localStorage.setItem("whistle.world.v2", JSON.stringify(world));
    localStorage.setItem("whistle.language", "ko");
    const state = window as typeof window & { audioProbe: Probe; audioIo: typeof io };
    state.audioProbe = { messages: [], contexts: [], rms: 0, peak: 0 };
    state.audioIo = io;
    const Original = window.AudioContext;
    window.AudioContext = class extends Original {
      constructor(options?: AudioContextOptions) { super(options); state.audioProbe.contexts.push(this); }
    };
  }, { world, io });
  await page.route("**/audio-test/webpd-runtime.js", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      const originalRun = WebPdRuntime.run;
      WebPdRuntime.run = async (context, patch, settings) => {
        const probe = window.audioProbe;
        const node = await originalRun(context, patch, {
          messageHandler(node, event) {
            if (event.data.type === 'io:messageSender') {
              const p = event.data.payload;
              const bus = Object.keys(window.audioIo.outputs).find(name => window.audioIo.outputs[name].nodeId === p.nodeId);
              probe.messages.push({bus, value: p.message});
            }
            settings.messageHandler(node, event);
          }
        });
        const analyser = context.createAnalyser();
        analyser.fftSize = 2048;
        node.connect(analyser);
        const wave = new Float32Array(2048);
        const timer = setInterval(() => {
          if(context.state === 'closed') { clearInterval(timer); return; }
          analyser.getFloatTimeDomainData(wave);
          probe.rms = Math.sqrt(wave.reduce((sum,n) => sum+n*n,0) / wave.length);
          probe.peak = Math.max(probe.peak, probe.rms);
        }, 20);
        return node;
      };
    ` });
  });
  await page.goto(".");
  await expect(page.getByRole("button", { name: "공유", exact: true }))
    .toHaveAttribute("aria-description", "이 브라우저에 저장됨");
}
const probe = (page: Page) => page.evaluate(() => {
  const p = (window as typeof window & { audioProbe: Probe }).audioProbe;
  return { messages: p.messages, contexts: p.contexts.map((ctx) => ctx.state), rms: p.rms, peak: p.peak };
});
const messages = async (page: Page, bus: string) => (await probe(page)).messages.filter((m) => m.bus === bus).map((m) => m.value);

test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) {
    await info.attach("audio-probe", { body: JSON.stringify(await probe(page)), contentType: "application/json" });
  }
});

test("real grid edits reach Pd once with material context; no-op, undo and loading stay silent", async ({ page }) => {
  const world = terrainFixtures().flat;
  for (const i of [0, 1, 2]) world.terrain!.tiles[i].surface = "soft";
  await openWorld(page, world);
  expect((await probe(page)).contexts).toEqual([]);
  await page.locator('[data-cell="5"]').click();
  expect((await probe(page)).contexts).toEqual([]);
  await page.getByRole("button", { name: "기호", exact: true }).click();
  await page.locator('[data-cell="0"]').click();
  await expect.poll(async () => (await messages(page, "whistle-edit")).length).toBe(1);
  expect((await messages(page, "whistle-edit"))[0]).toEqual([0.5 / 12, 0.5 / 12, 1, "circle", "add", "soft"]);
  await expect.poll(async () => (await probe(page)).peak).toBeGreaterThan(0.005);
  await page.locator('[data-cell="5"]').click();
  await expect.poll(async () => (await messages(page, "whistle-edit")).length).toBe(2);
  expect((await messages(page, "whistle-edit"))[1][2]).toBe(0);
  await page.locator('[data-cell="0"]').click();
  await expect.poll(async () => (await messages(page, "whistle-edit")).length).toBe(3);
  expect((await messages(page, "whistle-edit"))[2][4]).toBe("remove");
  await page.getByRole("button", { name: "되돌리기", exact: true }).click();
  await expect.poll(async () => (await probe(page)).rms).toBeLessThan(0.0001);
  expect((await messages(page, "whistle-edit")).length).toBe(3);
  expect((await probe(page)).contexts).toEqual(["running"]);
});

test("walking sends spatial state at fixed volume; blur and exit silence it", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const world = terrainFixtures().flat;
  world.start = { x: 6, z: 7 };
  for (const z of [6, 7, 8]) world.terrain!.tiles[z * 12 + 6].surface = "soft";
  for (let x = 0; x < 12; x++) world.terrain!.tiles[5 * 12 + x].surface = "rough";
  await openWorld(page, world);
  await page.getByRole("button", { name: "플레이", exact: true }).click();
  await expect(page.locator(".play-shell canvas")).toBeVisible();
  await expect.poll(async () => (await messages(page, "whistle-ready")).length).toBe(1);
  await page.keyboard.down("w");
  await expect.poll(async () => (await messages(page, "whistle-player")).some((m) => Number(m[2]) < 7.5 / 12 && Number(m[3]) > 0.1)).toBe(true);
  await expect.poll(async () => (await messages(page, "whistle-player")).some((m) => Number(m[4]) > 0.1), { timeout: 15000 }).toBe(true);
  await expect.poll(async () => (await probe(page)).peak).toBeGreaterThan(0.001);
  await page.keyboard.press("Space");
  await expect.poll(async () => (await messages(page, "whistle-player")).some((m) => m[5] === 0 && Number(m[1]) > 0.2)).toBe(true);
  await page.keyboard.up("w");
  await expect.poll(async () => (await messages(page, "whistle-player")).at(-1)?.[5]).toBe(1);
  expect((await messages(page, "whistle-player")).every((m) => m.length === 9)).toBe(true);
  await expect.poll(async () => (await probe(page)).rms).toBeGreaterThan(0.001);
  await page.keyboard.down("w");
  await expect.poll(async () => (await probe(page)).rms).toBeGreaterThan(0.001);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.keyboard.up("w");
  await expect.poll(async () => (await probe(page)).rms).toBeLessThan(0.0001);
  await page.keyboard.down("w");
  await expect.poll(async () => (await probe(page)).rms).toBeGreaterThan(0.001);
  await page.keyboard.up("w");
  await page.keyboard.press("Escape");
  await expect(page.locator(".workspace")).toBeVisible();
  await expect.poll(async () => (await probe(page)).rms).toBeLessThan(0.0001);
  expect((await messages(page, "whistle-gate")).at(-1)).toEqual([0]);
  expect((await probe(page)).contexts).toEqual(["running"]);
});

test("failed audio loading leaves editing usable and retries on the next edit", async ({ page }) => {
  await page.route("**/audio-test/patch.wasm", (route) => route.fulfill({ status: 503, body: "unavailable" }));
  await openWorld(page, terrainFixtures().flat);
  await page.getByRole("button", { name: "높이기", exact: true }).click();
  await page.locator('[data-cell="0"]').click();
  await expect(page.locator('[data-cell="0"]')).toHaveAccessibleName(/높이 1/);
  await expect.poll(async () => (await probe(page)).contexts).toEqual(["closed"]);
  await page.unroute("**/audio-test/patch.wasm");
  await page.locator('[data-cell="1"]').click();
  await expect.poll(async () => (await messages(page, "whistle-edit")).length).toBe(1);
  await expect(page.locator('[data-cell="1"]')).toHaveAccessibleName(/높이 1/);
  expect((await probe(page)).contexts).toEqual(["closed", "running"]);
});

test("existing approach sound rules use the same Pd session", async ({ page }) => {
  const world = terrainFixtures().flat;
  world.objects = [{ id: "tone", asset: "circle", x: 6, z: 9, rotation: 0, scale: 1 }];
  world.rules = [{ id: "sound", subject: "circle", trigger: "approach", token: "", source: "*",
    radius: 2, action: "sound", result: "", replacement: "", enabled: true }];
  await openWorld(page, world);
  await page.getByRole("button", { name: "플레이", exact: true }).click();
  await expect.poll(async () => (await messages(page, "whistle-event")).length).toBe(1);
  expect((await messages(page, "whistle-event"))[0]).toEqual([261.63, 0.12 / 1.3, 0]);
  await expect.poll(async () => (await probe(page)).peak).toBeGreaterThan(0.005);
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await probe(page)).rms).toBeLessThan(0.0001);
  expect((await probe(page)).contexts).toEqual(["running"]);
});
