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
