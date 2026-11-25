import { savedWorld } from "./world-storage";
import { test, expect, type Page } from "@playwright/test";
import { createTerrainWorld } from "../../lib/create-world";

test.setTimeout(60_000);
const saved = savedWorld;

async function open(page: Page) {
  const world = createTerrainWorld(17);
  world.timeOfDay = "noon";
  await page.addInitScript(world => {
    if (localStorage.getItem("floating-test")) return;
    localStorage.setItem("whistle.language", "ko");
    localStorage.setItem("whistle.world.v2", JSON.stringify(world));
    localStorage.setItem("floating-test", "1");
  }, world);
  await page.goto(".");
  await expect(page.locator(".live-preview canvas")).toHaveAttribute("data-ready", "true");
  return world;
}

async function play(page: Page) {
  await page.getByRole("button", { name: "플레이", exact: true }).click();
  const canvas = page.locator(".play-shell canvas");
  await expect(canvas).toHaveAttribute("data-ready", "true");
  return canvas;
}

test("build and erase paths over void, undo and reload without losing the isolated start", async ({ page }, testInfo) => {
  const world = await open(page);
  const start = world.start.z * world.size + world.start.x, next = start - world.size * 2;
  const cell = page.locator(`[data-cell="${next}"]`);
  await expect(page.locator(".tile-empty")).toHaveCount(130);
  await expect(cell).toHaveAccessibleName(/허공/);
  await page.screenshot({ path: testInfo.outputPath("floating-editor.png") });
  await page.getByRole("button", { name: "바닥", exact: true }).click();
  await cell.click();
  await expect(cell).toHaveAccessibleName(/높이 0 바닥/);
  await expect.poll(async () => (await saved(page)).terrain!.tiles[next].void).toBeUndefined();
  await page.getByRole("button", { name: "타일 지우기", exact: true }).click();
  await page.locator(`[data-cell="${start}"]`).click();
  await expect(page.locator(`[data-cell="${start}"]`)).toHaveAccessibleName(/높이 0 바닥.*시작점/);
  await cell.click();
  await expect(cell).toHaveAccessibleName(/허공/);
  await page.getByRole("button", { name: "되돌리기", exact: true }).click();
  await expect(cell).toHaveAccessibleName(/높이 0 바닥/);
  await expect.poll(async () => (await saved(page)).terrain!.tiles[next].void).toBeUndefined();
  await page.reload();
  await expect(cell).toHaveAccessibleName(/높이 0 바닥/);
  const canvas = await play(page);
  await page.keyboard.down("KeyW");
  await expect.poll(async () => Number(await canvas.getAttribute("data-player-z"))).toBeLessThan(world.start.z - 1.8);
  await page.keyboard.up("KeyW");
  await expect(canvas).not.toHaveAttribute("data-motion", "fall");
});

test("walking and jumping stop at void edges but an authored hole still causes falling", async ({ page }, testInfo) => {
  const world = await open(page);
  let canvas = await play(page);
  await page.keyboard.down("KeyW");
  await expect.poll(async () => Number(await canvas.getAttribute("data-player-z"))).toBeLessThan(world.start.z - 1.25);
  await page.waitForTimeout(900);
  expect(Number(await canvas.getAttribute("data-player-z"))).toBeGreaterThanOrEqual(world.start.z - 1.42);
  await page.keyboard.press("Space");
  await page.waitForTimeout(1200);
  expect(Number(await canvas.getAttribute("data-player-z"))).toBeGreaterThanOrEqual(world.start.z - 1.42);
  await expect(canvas).not.toHaveAttribute("data-motion", "fall");
  await page.keyboard.up("KeyW");
  await page.screenshot({ path: testInfo.outputPath("floating-play.png") });
  await page.keyboard.down("KeyS");
  try { await expect.poll(async () => Number(await canvas.getAttribute("data-player-z"))).toBeGreaterThan(world.start.z - .2); }
  finally { await page.keyboard.up("KeyS"); }
  await page.keyboard.press("Escape");
  const next = (world.start.z - 1) * world.size + world.start.x;
  const cell = page.locator(`[data-cell="${next}"]`);
  await page.getByRole("button", { name: "바닥", exact: true }).click();
  await cell.click();
  await page.getByRole("button", { name: "꺼짐", exact: true }).click();
  await cell.click();
  await expect(cell).toHaveAccessibleName(/꺼짐/);
  canvas = await play(page);
  await page.keyboard.down("KeyW");
  try { await expect(canvas).toHaveAttribute("data-motion", "fall", { timeout: 15_000 }); }
  finally { await page.keyboard.up("KeyW"); }
});
