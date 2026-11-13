import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { terrainFixtures } from "../terrain-fixtures";
import { flatTerrain } from "../../lib/terrain";

test.setTimeout(90_000);

const data = async (page: Page) => JSON.parse((await page.locator("#position-data").textContent())!);
const messages = async (page: Page) => JSON.parse((await page.locator("#pd-messages").textContent())!);

async function openLive(page: Page, context: BrowserContext, stored: string) {
  await context.addInitScript(() => {
    Object.defineProperty(window, "devicePixelRatio", { value: 0.5 });
    localStorage.setItem("whistle.language", "ko");
  });
  await page.goto("uwb-lab/index.html");
  await page.evaluate((stored) => localStorage.setItem("whistle.world.v2", stored), stored);
  const editor = await context.newPage();
  await editor.goto(".");
  await expect(editor.locator(".workspace")).toBeVisible();
  await page.bringToFront();
  const tabs = context.pages().length;
  await page.getByRole("button", { name: "Whistle 3D", exact: true }).click();
  expect(context.pages()).toHaveLength(tabs);
  await expect(page.getByRole("button", { name: "Whistle 3D", exact: true })).toHaveAttribute("aria-pressed", "true");
  return editor;
}

test("live grid edits and undo reach the displayed world and Pd without relying on autosave", async ({ page, context }) => {
  const world = terrainFixtures().flat;
  world.title = "실제 편집 중인 세계";
  const stored = JSON.stringify(world);
  const editor = await openLive(page, context, stored);
  await expect(page.locator("#live-status")).toHaveText("편집 중인 세계에 연결됨");
  await expect(editor.getByRole("button", { name: "공유", exact: true })).toHaveAttribute("aria-description", "이 브라우저에 저장됨");
  await editor.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === "whistle.world.v2") throw new DOMException("quota", "QuotaExceededError");
      return original.call(this, key, value);
    };
  });
  await expect(page.getByRole("heading", { name: world.title, exact: true })).toBeVisible();
  await page.bringToFront();
  await page.getByLabel("보드 높이 (m)", { exact: true }).fill("1.5");
  await page.getByRole("button", { name: "오디오 시작", exact: true }).click();
  await expect.poll(async () => (await messages(page))["whistle-player"]?.[3]).toBe(0);
  const initialPosition = (await data(page)).grid;
  await editor.bringToFront();
  await editor.getByRole("button", { name: "부드러운 바닥", exact: true }).click();
  for (const i of [61, 62, 73, 74]) await editor.locator(`[data-cell="${i}"]`).click();
  await expect.poll(async () => (await messages(page))["whistle-player"]?.[3]).toBe(1);
  await expect(page.locator("#audio-status")).toHaveText("오디오 실행 중");
  await expect(page.locator(".map rect").nth(61)).toHaveAttribute("fill", "#b5cc9c");
  expect((await data(page)).grid).toEqual(initialPosition);
  expect(await page.evaluate(() => localStorage.getItem("whistle.world.v2"))).toBe(stored);
  await editor.getByRole("button", { name: "거친 바닥", exact: true }).click();
  for (const i of [61, 62, 73, 74]) await editor.locator(`[data-cell="${i}"]`).click();
  await expect.poll(async () => (await messages(page))["whistle-player"]?.[4]).toBe(1);
  await editor.getByRole("button", { name: "되돌리기", exact: true }).click();
  await expect.poll(async () => (await messages(page))["whistle-player"]?.[4]).toBe(0.75);
  await editor.getByRole("button", { name: "다시 실행", exact: true }).click();
  await expect.poll(async () => (await messages(page))["whistle-player"]?.[4]).toBe(1);
  await editor.getByRole("button", { name: "높이기", exact: true }).click();
  await editor.locator('[data-cell="61"]').click();
  await expect.poll(async () => Number((await messages(page))["whistle-player"]?.[1])).toBeGreaterThan(0.2);
  expect((await messages(page))["whistle-board-height"]).toEqual([1.5]);
  expect((await data(page)).boardHeight).toBe(1.5);
  await editor.close();
  await expect(page.locator("#live-status")).toContainText("연결 끊김");
  await expect.poll(async () => (await messages(page))["whistle-gate"]).toEqual([0]);
  await expect(page.getByTestId("position-marker")).toHaveCount(0);
});

test("world replacement and reload stay connected; disconnect isolates later editor changes", async ({ page, context }) => {
  const world = terrainFixtures().flat;
  const editor = await openLive(page, context, JSON.stringify(world));
  await expect(page.locator("#live-status")).toHaveText("편집 중인 세계에 연결됨");
  const next = terrainFixtures().flat;
  next.size = 6;
  next.terrain = flatTerrain(6);
  next.start = { x: 3, z: 5 };
  next.title = "새로 가져온 실제 세계";
  await editor.locator('input[type="file"]').setInputFiles({ name: "world.json", mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(next)) });
  await expect(page.getByRole("heading", { name: next.title, exact: true })).toBeVisible();
  await expect(page.locator(".map rect")).toHaveCount(6 * 6);
  expect((await data(page)).metres).toEqual({ x: 1, z: 3 });
  expect((await data(page)).grid).toEqual({ x: 0.5, z: 2.5 });
  await expect(editor.getByRole("button", { name: "공유", exact: true })).toHaveAttribute("aria-description", "이 브라우저에 저장됨");
  await editor.reload();
  await expect(page.locator("#live-status")).toHaveText("편집 중인 세계에 연결됨");
  await expect(page.getByRole("heading", { name: next.title, exact: true })).toBeVisible();
  await page.bringToFront();
  await page.getByRole("button", { name: "샘플 세계", exact: true }).click();
  await expect(page.locator("#live-status")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "샘플 세계", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#audio-status")).toHaveText("오디오 꺼짐");
  await editor.bringToFront();
  await editor.getByRole("button", { name: "높이기", exact: true }).click();
  await editor.locator('[data-cell="0"]').click();
  await expect(editor.getByRole("button", { name: "공유", exact: true })).toHaveAttribute("aria-description", "이 브라우저에 저장됨");
  await expect(page.getByRole("heading", { name: "UWB 샘플 · 풀 / 바위 / 물", exact: true })).toBeVisible();
  await expect(page.locator(".map rect")).toHaveCount(12 * 12);
  await editor.close();
});

test("a failed editor load cannot replace the test world or enable live audio", async ({ page, context }) => {
  const editor = await openLive(page, context, "{broken-json");
  await expect(page.locator("#live-status")).toContainText("불러오지 못");
  await expect(page.getByRole("button", { name: "오디오 시작", exact: true })).toBeDisabled();
  await expect(page.getByTestId("position-marker")).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("whistle.world.v2"))).toBe("{broken-json");
  const world = terrainFixtures().flat;
  world.title = "복구된 세계";
  await editor.locator('input[type="file"]').setInputFiles({ name: "world.json", mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(world)) });
  await expect(page.locator("#live-status")).toHaveText("편집 중인 세계에 연결됨");
  await expect(page.getByRole("heading", { name: world.title, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "오디오 시작", exact: true })).toBeEnabled();
  await editor.close();
});

test("Whistle 3D waits without a saved world and connects when an editor opens later", async ({ page, context }) => {
  await context.addInitScript(() => Object.defineProperty(window, "devicePixelRatio", { value: 0.5 }));
  await page.goto("uwb-lab/index.html");
  await page.getByRole("button", { name: "Whistle 3D", exact: true }).click();
  await expect(page.locator("#live-status")).toHaveText("Whistle 편집기를 열어 주세요.");
  await expect(page.getByRole("button", { name: "오디오 시작", exact: true })).toBeDisabled();
  expect(context.pages()).toHaveLength(1);
  const world = terrainFixtures().flat;
  world.title = "나중에 연 편집기";
  await page.evaluate((world) => localStorage.setItem("whistle.world.v2", JSON.stringify(world)), world);
  const editor = await context.newPage();
  await editor.goto(".");
  await expect(page.locator("#live-status")).toHaveText("편집 중인 세계에 연결됨");
  await expect(page.getByRole("heading", { name: world.title, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "오디오 시작", exact: true })).toBeEnabled();
  await editor.close();
});
