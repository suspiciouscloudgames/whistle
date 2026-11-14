import { test, expect, type Page } from "@playwright/test";
import { createSocket } from "node:dgram";
import { readFileSync } from "node:fs";
import { startBridge } from "../../scripts/uwb/bridge";
import { parseConfig, distanceTo } from "../../lib/uwb/solver";
import { createLabWorld } from "../../uwb-lab/world";

test.setTimeout(60_000);
const config = parseConfig({ ...JSON.parse(readFileSync("config/uwb.example.json", "utf8")), mode: "3d", smoothingMs: 0 });
const data = async (page: Page) => JSON.parse((await page.locator("#position-data").textContent())!);
const messages = async (page: Page) => JSON.parse((await page.locator("#pd-messages").textContent())!);

async function setup(page: Page) {
  const bridge = await startBridge(config, { wsPort: 0, udpPort: 0, log: () => {} });
  const udp = createSocket("udp4");
  let seq = 0;
  let active = true;
  let tagId = "0";
  let valid = true;
  let point = { x: 1, z: 3, boardHeight: 1.2 };
  const timer = setInterval(() => {
    if (!active) return;
    udp.send(JSON.stringify({ type: "ranges", tagId, seq: ++seq,
      ranges: valid ? config.anchors.map((a) => ({ anchorId: a.id, distance: distanceTo(point, a) })) : [],
    }), bridge.udpPort, "127.0.0.1");
  }, 100);
  await page.addInitScript(() => Object.defineProperty(window, "devicePixelRatio", { value: 0.5 }));
  await page.goto("uwb-lab/index.html");
  await page.getByRole("radio", { name: "실제 데이터 · PC 수신기", exact: true }).check();
  await page.getByLabel("수신기 주소", { exact: true }).fill(`ws://127.0.0.1:${bridge.wsPort}`);
  return {
    move: (p: typeof point) => { point = p; }, pause: () => { active = false; }, resume: () => { active = true; },
    invalid: () => { valid = false; }, valid: () => { valid = true; }, tag: (id: string) => { tagId = id; },
    stopBridge: bridge.close,
    close: async () => { clearInterval(timer); udp.close(); await bridge.close(); },
  };
}

test("UDP ranges reach the existing scene and Pd; height, invalid frames and timeouts stay separate", async ({ page }) => {
  const device = await setup(page);
  try {
    await expect(page.getByRole("button", { name: "오디오 시작", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "연결 / 다시 연결", exact: true }).click();
    await expect(page.locator("#device-status")).toContainText("태그 0 수신 중");
    await expect(page.locator("#device-status")).toContainText("높이 UWB 계산");
    await expect(page.getByLabel("관객 X (m)", { exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "관객 위치 평면도", exact: true })).toBeDisabled();
    await expect.poll(async () => (await data(page)).metres?.x).toBeCloseTo(1, 4);
    await expect.poll(async () => (await data(page)).pd?.grass).toBeGreaterThan(0);
    await page.getByRole("button", { name: "오디오 시작", exact: true }).click();
    await expect(page.locator("#audio-status")).toHaveText("오디오 실행 중");
    await expect.poll(async () => (await messages(page))["whistle-board-height"]?.[0]).toBeCloseTo(1.2, 4);
    const ground = (await data(page)).pd.y;
    device.move({ x: 1, z: 3, boardHeight: 2.1 });
    await expect.poll(async () => (await messages(page))["whistle-board-height"]?.[0]).toBeCloseTo(2.1, 4);
    expect((await data(page)).pd.y).toBeCloseTo(ground, 8);
    device.move({ x: 3, z: 3, boardHeight: 2.1 });
    await expect(page.locator("#rough")).toHaveText("1.000");
    expect((await messages(page))["whistle-player"]).toHaveLength(9);
    device.invalid();
    await expect(page.locator("#device-status")).toContainText("앵커가 4개 이상");
    await expect.poll(async () => (await messages(page))["whistle-gate"]).toEqual([0]);
    await expect(page.getByTestId("position-marker")).toHaveCount(0);
    device.valid();
    await expect.poll(async () => (await messages(page))["whistle-gate"]).toEqual([1]);
    device.pause();
    await expect(page.locator("#device-status")).toContainText("1초 동안 위치 수신 없음");
    await expect.poll(async () => (await messages(page))["whistle-gate"]).toEqual([0]);
    device.resume();
    await expect.poll(async () => (await messages(page))["whistle-gate"]).toEqual([1]);
    await page.getByRole("button", { name: "오디오 종료", exact: true }).click();
    device.move({ x: 5, z: 3, boardHeight: 1 });
    await expect(page.locator("#water")).toHaveText("물속");
    await expect(page.locator("#audio-status")).toHaveText("오디오 꺼짐");
    await page.getByRole("radio", { name: "가상 좌표 직접 입력", exact: true }).check();
    await expect(page.getByLabel("관객 X (m)", { exact: true })).toBeEnabled();
    expect((await data(page)).metres).toEqual({ x: 1, z: 3 });
    expect((await data(page)).boardHeight).toBe(0);
  } finally { await device.close(); }
});

test("tag selection, saved Whistle world and connection loss do not use another or stale position", async ({ page }) => {
  const device = await setup(page);
  try {
    const world = createLabWorld();
    world.title = "장비 연결 세계";
    const stored = JSON.stringify(world);
    await page.evaluate((stored) => localStorage.setItem("whistle.world.v2", stored), stored);
    await page.getByRole("button", { name: "Whistle 3D", exact: true }).click();
    await expect(page.getByRole("heading", { name: world.title, exact: true })).toBeVisible();
    device.tag("1");
    await page.getByRole("button", { name: "연결 / 다시 연결", exact: true }).click();
    await expect(page.locator("#device-status")).toHaveText("태그 0 데이터 대기");
    await expect(page.getByRole("button", { name: "오디오 시작", exact: true })).toBeDisabled();
    await page.getByLabel("관객 태그 ID", { exact: true }).fill("1");
    await page.getByRole("button", { name: "연결 / 다시 연결", exact: true }).click();
    await expect(page.locator("#device-status")).toContainText("태그 1 수신 중");
    await page.getByRole("button", { name: "오디오 시작", exact: true }).click();
    await expect.poll(async () => (await messages(page))["whistle-gate"]).toEqual([1]);
    await page.getByRole("button", { name: "연결 종료", exact: true }).click();
    await expect.poll(async () => (await messages(page))["whistle-gate"]).toEqual([0]);
    await expect(page.getByTestId("position-marker")).toHaveCount(0);
    await page.getByRole("button", { name: "연결 / 다시 연결", exact: true }).click();
    await expect.poll(async () => (await messages(page))["whistle-gate"]).toEqual([1]);
    device.pause();
    await device.stopBridge();
    await expect(page.locator("#device-status")).toContainText("PC 수신기 연결 끊김");
    await expect.poll(async () => (await messages(page))["whistle-gate"]).toEqual([0]);
    expect(await page.evaluate(() => localStorage.getItem("whistle.world.v2"))).toBe(stored);
  } finally { await device.close(); }
});
