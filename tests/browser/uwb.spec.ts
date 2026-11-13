import { test, expect, type Page } from "@playwright/test";
import { createLabWorld } from "../../uwb-lab/world";

test.setTimeout(60_000);

const data = async (page: Page) => JSON.parse((await page.locator("#position-data").textContent())!);
const messages = async (page: Page) => JSON.parse((await page.locator("#pd-messages").textContent())!);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, "devicePixelRatio", { value: 0.5 }));
  await page.goto("uwb-lab/index.html");
});

test("simulated coordinates update the scene, mapping and environment", async ({ page }) => {
  await expect(page.locator(".scene canvas")).toBeVisible();
  await expect(page.locator("#tracking-status")).toHaveText("위치 연결됨");
  expect((await data(page)).pd.grass).toBeGreaterThan(0);
  await page.getByRole("button", { name: "중앙 위치", exact: true }).click();
  expect((await data(page)).grid).toEqual({ x: 5.5, z: 5.5 });
  await expect(page.locator("#rough")).toHaveText("1.000");
  await expect(page.getByTestId("position-marker")).toHaveAttribute("cx", "6");
  await page.getByRole("button", { name: "오른쪽 위치", exact: true }).click();
  await expect(page.locator("#water")).toHaveText("물속");
  await page.getByLabel("가로 (m)", { exact: true }).fill("12");
  await page.getByLabel("관객 X (m)", { exact: true }).fill("6");
  expect((await data(page)).pd.x).toBe(0.5);
  await page.getByLabel("좌표 JSON", { exact: true }).fill('{"x":3,"z":1.5}');
  await page.getByRole("button", { name: "좌표 적용", exact: true }).click();
  expect((await data(page)).pd.x).toBe(0.25);
  expect((await data(page)).pd.z).toBe(0.25);
  await page.getByLabel("관객 X (m)", { exact: true }).fill("13");
  await expect(page.locator("#tracking-status")).toContainText("공간 범위 밖");
  await expect(page.getByTestId("position-marker")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "오디오 시작", exact: true })).toBeDisabled();
});

test("Pd receives mapped values and stops for invalid input and blur", async ({ page }) => {
  await page.getByRole("button", { name: "오디오 시작", exact: true }).click();
  await expect(page.locator("#audio-status")).toHaveText("오디오 실행 중");
  await expect.poll(async () => (await messages(page))["whistle-player"]?.[0]).toBe(1 / 6);
  await page.getByRole("button", { name: "중앙 위치", exact: true }).click();
  await expect.poll(async () => (await messages(page))["whistle-player"]?.slice(2, 5)).toEqual([0.5, 0, 1]);
  expect((await messages(page))["whistle-player"]).toHaveLength(9);
  await page.getByLabel("가로 (m)", { exact: true }).fill("0");
  await expect.poll(async () => (await messages(page))["whistle-gate"]).toEqual([0]);
  await expect(page.locator("#tracking-status")).toContainText("0보다 큰 값");
  await page.getByLabel("가로 (m)", { exact: true }).fill("6");
  await expect.poll(async () => (await messages(page))["whistle-gate"]).toEqual([1]);
  await page.getByLabel("좌표 JSON", { exact: true }).fill('{"x":"2","z":1}');
  await page.getByRole("button", { name: "좌표 적용", exact: true }).click();
  await expect.poll(async () => (await messages(page))["whistle-gate"]).toEqual([0]);
  await page.getByRole("button", { name: "왼쪽 위치", exact: true }).click();
  await expect.poll(async () => (await messages(page))["whistle-gate"]).toEqual([1]);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(page.locator("#audio-status")).toHaveText("오디오 꺼짐");
  await page.getByRole("button", { name: "오디오 시작", exact: true }).click();
  await expect(page.locator("#audio-status")).toHaveText("오디오 실행 중");
  await page.getByRole("button", { name: "오디오 종료", exact: true }).click();
  await expect(page.locator("#audio-status")).toHaveText("오디오 꺼짐");
});

test("saved and imported worlds are read without overwriting game storage", async ({ page }) => {
  const world = createLabWorld();
  world.title = "저장된 테스트 세계";
  world.terrain!.tiles[6 * world.size + 6].hole = true;
  const stored = JSON.stringify(world);
  await page.evaluate((stored) => localStorage.setItem("whistle.world.v2", stored), stored);
  await page.getByRole("button", { name: "저장된 세계 읽기", exact: true }).click();
  await expect(page.getByRole("heading", { name: world.title })).toBeVisible();
  await page.getByLabel("관객 X (m)", { exact: true }).fill("3.25");
  await page.getByLabel("관객 Z (m)", { exact: true }).fill("3.25");
  await expect(page.locator("#tracking-status")).toContainText("바닥 없음");
  await expect(page.getByRole("button", { name: "오디오 시작", exact: true })).toBeDisabled();
  const input = page.getByLabel("세계 JSON 파일", { exact: true });
  await input.setInputFiles({ name: "bad.json", mimeType: "application/json", buffer: Buffer.from("{}") });
  await expect(page.getByRole("heading", { name: world.title })).toBeVisible();
  const imported = { ...world, title: "파일 세계" };
  await input.setInputFiles({ name: "world.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(imported)) });
  await expect(page.getByRole("heading", { name: "파일 세계" })).toBeVisible();
  await page.getByRole("button", { name: "샘플 세계", exact: true }).click();
  expect(await page.evaluate(() => localStorage.getItem("whistle.world.v2"))).toBe(stored);
});

test("audio loading failure can retry and cancellation does not start a late session", async ({ page }) => {
  await page.route("**/audio-test/patch.wasm", (route) => route.fulfill({ status: 503, body: "unavailable" }));
  await page.getByRole("button", { name: "오디오 시작", exact: true }).click();
  await expect(page.locator("#audio-status")).toContainText("불러오지 못했습니다");
  await page.unroute("**/audio-test/patch.wasm");
  let release!: () => void;
  const hold = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/audio-test/patch.wasm", async (route) => { await hold; await route.continue(); });
  await page.getByRole("button", { name: "오디오 시작", exact: true }).click();
  await expect(page.locator("#audio-status")).toHaveText("패치 준비 중");
  await page.getByRole("button", { name: "오디오 종료", exact: true }).click();
  release();
  await expect(page.locator("#audio-status")).toHaveText("오디오 꺼짐");
  await page.unroute("**/audio-test/patch.wasm");
  await page.getByRole("button", { name: "오디오 시작", exact: true }).click();
  await expect(page.locator("#audio-status")).toHaveText("오디오 실행 중");
});

test("board height changes Pd output independently of virtual ground and survives restart", async ({ page }) => {
  test.setTimeout(90_000);
  await page.route("**/audio-test/webpd-runtime.js", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      const originalRun = WebPdRuntime.run;
      WebPdRuntime.run = async (...args) => {
        const node = await originalRun(...args);
        const context = args[0];
        const analyser = context.createAnalyser();
        analyser.fftSize = 4096;
        analyser.smoothingTimeConstant = 0;
        node.connect(analyser);
        window.heightProbe = () => {
          const wave = new Float32Array(4096);
          const spectrum = new Float32Array(2048);
          analyser.getFloatTimeDomainData(wave);
          analyser.getFloatFrequencyData(spectrum);
          let peak = 0;
          for (let i = 1; i < spectrum.length; i++) if (spectrum[i] > spectrum[peak]) peak = i;
          return { rms: Math.sqrt(wave.reduce((sum, n) => sum + n * n, 0) / wave.length),
            hz: peak * context.sampleRate / analyser.fftSize };
        };
        return node;
      };
    ` });
  });
  const probe = () => page.evaluate(() => (window as typeof window & {
    heightProbe: () => { rms: number; hz: number };
  }).heightProbe());
  const initial = await data(page);
  const baseHz = 220 + 220 * initial.pd.z + 220 * initial.pd.grass + 440 * initial.pd.rough;
  const height = page.getByLabel("보드 높이 (m)", { exact: true });
  await page.getByRole("button", { name: "오디오 시작", exact: true }).click();
  await expect(page.locator("#audio-status")).toHaveText("오디오 실행 중");
  for (const metres of [0, 2, 10, 0]) {
    await height.fill(String(metres));
    await expect.poll(async () => (await messages(page))["whistle-board-height"]).toEqual([metres]);
    await expect.poll(async () => Math.abs((await probe()).hz - (baseHz + 110 * metres))).toBeLessThan(16);
    expect((await probe()).rms).toBeGreaterThan(0.001);
    expect((await data(page)).grid).toEqual(initial.grid);
    expect((await data(page)).pd).toEqual(initial.pd);
    expect((await messages(page))["whistle-player"]).toHaveLength(9);
    expect((await messages(page))["whistle-player"][1]).toBe(initial.pd.y);
  }
  for (const invalid of ["", "-1", "11"]) {
    await height.fill(invalid);
    await expect(page.locator("#height-status")).toContainText("오디오 정지");
    await expect.poll(async () => (await messages(page))["whistle-gate"]).toEqual([0]);
    await expect.poll(async () => (await probe()).rms).toBeLessThan(0.0001);
  }
  await page.getByLabel("좌표 JSON", { exact: true }).fill('{"x":1,"z":3,"boardHeight":1.5}');
  await page.getByRole("button", { name: "좌표 적용", exact: true }).click();
  await expect.poll(async () => (await messages(page))["whistle-board-height"]).toEqual([1.5]);
  await expect.poll(async () => Math.abs((await probe()).hz - (baseHz + 165))).toBeLessThan(16);
  await page.getByRole("button", { name: "오디오 종료", exact: true }).click();
  await page.getByRole("button", { name: "오디오 시작", exact: true }).click();
  await expect.poll(async () => (await messages(page))["whistle-board-height"]).toEqual([1.5]);
  await expect.poll(async () => Math.abs((await probe()).hz - (baseHz + 165))).toBeLessThan(16);
  await page.getByLabel("좌표 JSON", { exact: true }).fill('{"x":3,"z":3}');
  await page.getByRole("button", { name: "좌표 적용", exact: true }).click();
  await expect(height).toHaveValue("1.5");
  await page.getByRole("button", { name: "왼쪽 위치", exact: true }).click();
  await expect(height).toHaveValue("1.5");
  for (const invalid of ['"2"', '-1', '1e999', 'null']) {
    await page.getByLabel("좌표 JSON", { exact: true }).fill(`{"x":5,"z":2,"boardHeight":${invalid}}`);
    await page.getByRole("button", { name: "좌표 적용", exact: true }).click();
    await expect(page.locator("#tracking-status")).toContainText("보드 높이");
    await expect.poll(async () => (await messages(page))["whistle-gate"]).toEqual([0]);
    await expect(height).toHaveValue("1.5");
    await expect(page.getByLabel("관객 X (m)", { exact: true })).toHaveValue("1");
  }
});
