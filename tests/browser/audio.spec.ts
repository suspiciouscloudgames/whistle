import { test, expect, type Page } from "@playwright/test";

type Level = { rms: number; hz: number };
const levels = async (page: Page): Promise<Level[]> =>
  JSON.parse((await page.locator("#meter").getAttribute("data-levels"))!);
const received = async (page: Page) => JSON.parse((await page.locator("#messages").textContent())!);

async function start(page: Page) {
  await page.getByRole("button", { name: "오디오 시작", exact: true }).click();
  await expect(page.locator("#status")).toHaveText("실행 중");
  await expect.poll(async () => (await received(page))["whistle-ready"]).toEqual(["bang"]);
}

test.beforeEach(async ({ page }) => {
  await page.goto("audio-lab/index.html");
});

test("Pd edit events change the emitted tone and decay back to silence", async ({ page }) => {
  await expect(page.locator("#edit")).toBeDisabled();
  await start(page);
  await expect.poll(async () => (await levels(page))[0].rms).toBeLessThan(0.0001);
  for (const overlap of [0, 1]) {
    await page.locator("#overlap").fill(String(overlap));
    await page.getByRole("button", { name: "배치 소리", exact: true }).click();
    await expect.poll(async () => (await received(page))["whistle-edit"]).toEqual([0.5, 0.5, overlap]);
    await expect.poll(async () => {
      const [left] = await levels(page);
      return left.rms > 0.005 && Math.abs(left.hz - (440 + overlap * 220)) < 16;
    }, { intervals: [10, 20, 20] }).toBe(true);
    await expect.poll(async () => (await levels(page))[0].rms).toBeLessThan(0.0001);
  }
});

test("Pd receives position and materials without speed and uses a fixed level", async ({ page }) => {
  await start(page);
  await expect(page.locator("#speed")).toHaveCount(0);
  await page.locator("#player-x").fill("0");
  await page.locator("#player-y").fill("2.5");
  const send = page.getByRole("button", { name: "이동 상태 보내기", exact: true });
  await send.click();
  await expect.poll(async () => (await received(page))["whistle-player"]).toEqual([0, 2.5, 0, 0, 0]);
  await expect.poll(async () => {
    const [l, r] = await levels(page);
    return l.rms > 0.01 && r.rms < 0.0001 && Math.abs(l.hz - 220) < 16;
  }).toBe(true);

  for (const y of [7.5, 2.5]) {
    await page.locator("#player-y").fill(String(y));
    await send.click();
    await expect.poll(async () => (await received(page))["whistle-player"]).toEqual([0, y, 0, 0, 0]);
    await expect.poll(async () => Math.abs((await levels(page))[0].hz - 220)).toBeLessThan(16);
  }

  await page.locator("#player-x").fill("1");
  await page.locator("#player-z").fill("0.5");
  await page.locator("#grass").fill("1");
  await page.locator("#rough").fill("0.5");
  await send.click();
  await expect.poll(async () => (await received(page))["whistle-player"]).toEqual([1, 2.5, 0.5, 1, 0.5]);
  await expect.poll(async () => {
    const [l, r] = await levels(page);
    return r.rms > 0.01 && l.rms < 0.0001 && Math.abs(r.hz - 770) < 16;
  }).toBe(true);
  await expect.poll(async () => (await levels(page))[1].rms).toBeLessThan(0.016);
  await page.getByRole("button", { name: "음소거", exact: true }).click();
  await expect.poll(async () => (await levels(page))[1].rms).toBeLessThan(0.0001);
  await page.getByRole("button", { name: "음소거 해제", exact: true }).click();
  await expect.poll(async () => (await levels(page))[1].rms).toBeGreaterThan(0.01);
  await expect.poll(async () => (await levels(page))[1].rms).toBeLessThan(0.016);
});

test("audio starts only on click, closes cleanly and can retry a failed patch load", async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as typeof window & { contexts: AudioContext[]; microphoneCalls: number };
    state.contexts = [];
    state.microphoneCalls = 0;
    const Original = window.AudioContext;
    window.AudioContext = class extends Original {
      constructor(options?: AudioContextOptions) { super(options); state.contexts.push(this); }
    };
    navigator.mediaDevices.getUserMedia = async () => {
      state.microphoneCalls++;
      throw new Error("Unexpected microphone request");
    };
  });
  await page.reload();
  const audioState = () => page.evaluate(() => {
    const state = window as typeof window & { contexts: AudioContext[]; microphoneCalls: number };
    return { states: state.contexts.map((ctx) => ctx.state), microphoneCalls: state.microphoneCalls };
  });
  expect(await audioState()).toEqual({ states: [], microphoneCalls: 0 });
  await page.route("**/audio-test/patch.wasm", (route) => route.fulfill({ status: 503, body: "unavailable" }));
  await page.getByRole("button", { name: "오디오 시작", exact: true }).click();
  await expect(page.locator("#status")).toHaveText("Pd 패치를 불러오지 못했습니다.");
  await expect.poll(audioState).toEqual({ states: ["closed"], microphoneCalls: 0 });
  await page.unroute("**/audio-test/patch.wasm");
  await start(page);
  await page.getByRole("button", { name: "오디오 종료", exact: true }).click();
  await expect(page.locator("#status")).toHaveText("종료됨");
  await expect.poll(audioState).toEqual({ states: ["closed", "closed"], microphoneCalls: 0 });
  await start(page);
  await expect.poll(audioState).toEqual({ states: ["closed", "closed", "running"], microphoneCalls: 0 });
});
