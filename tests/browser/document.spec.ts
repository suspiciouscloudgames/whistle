import { savedWorld } from "./world-storage";
import { test, expect, type Page } from "@playwright/test";
import { terrainFixtures } from "../terrain-fixtures";
import type { World } from "../../lib/world";

async function openWorld(page: Page, world: World) {
  await page.addInitScript((world) => {
    localStorage.setItem("whistle.world.v2", JSON.stringify(world));
    localStorage.setItem("whistle.language", "ko");
  }, world);
  await page.goto(".");
  await expect(page.getByRole("button", { name: "파일 저장", exact: true }))
    .toHaveAttribute("aria-description", "이 브라우저에 저장됨");
}


test("file imports remain undoable while restarting clears history", async ({ page }) => {
  await openWorld(page, terrainFixtures().flat);
  const cell = page.locator('[data-cell="0"]');
  const undo = page.getByRole("button", { name: "되돌리기", exact: true });
  const redo = page.getByRole("button", { name: "다시 실행", exact: true });
  await page.getByRole("button", { name: "높이기", exact: true }).click();
  await cell.click();
  const imported = terrainFixtures().flat;
  imported.title = "가져온 문서";
  imported.terrain!.tiles[0].height = 2;
  await page.locator('input[type="file"]').setInputFiles({
    name: "document.json", mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(imported)),
  });
  await expect(cell).toHaveAccessibleName(/높이 2/);
  await undo.click();
  await expect(cell).toHaveAccessibleName(/높이 1/);
  await redo.click();
  await expect(cell).toHaveAccessibleName(/높이 2/);
  await page.getByRole("button", { name: "다시 시작", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "다시 시작", exact: true }).click();
  await expect.poll(async () => (await savedWorld(page)).title).toBe("무제");
  await expect(undo).toBeDisabled();
  await expect(redo).toBeDisabled();
});

test("old shared links do not replace the document or its undo history", async ({ page }) => {
  const original = terrainFixtures().flat;
  await openWorld(page, original);
  await page.getByRole("button", { name: "높이기", exact: true }).click();
  await page.locator('[data-cell="0"]').click();
  const shared = terrainFixtures().flat;
  shared.title = "old link";
  const encoded = "j" + Buffer.from(JSON.stringify(shared)).toString("base64url");
  await page.evaluate(encoded => { location.hash = `world=${encoded}`; }, encoded);
  await expect(page.locator('[data-cell="0"]')).toHaveAccessibleName(/높이 1/);
  await expect.poll(async () => (await savedWorld(page)).terrain!.tiles[0].height).toBe(1);
  expect((await savedWorld(page)).title).toBe(original.title);
  await page.getByRole("button", { name: "되돌리기", exact: true }).click();
  await expect(page.locator('[data-cell="0"]')).toHaveAccessibleName(/높이 0/);
});

test("audio failures explain retry without blocking editing", async ({ page }) => {
  let attempts = 0;
  await page.route(/\/audio\/engine\/pd4web\.js(\?|$)/, async route => { attempts++; await route.abort(); });
  await openWorld(page, terrainFixtures().flat);
  await page.getByRole("button", { name: "높이기", exact: true }).click();
  await page.locator('[data-cell="0"]').click();
  await expect.poll(() => attempts).toBeGreaterThan(0);
  await expect(page.locator(".toast")).toContainText("다음 클릭에서 다시 시도합니다");
  await page.getByRole("button", { name: "장면 제목 입력", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator(".toast")).toContainText("다음 클릭에서 다시 시도합니다");
});

test("legacy terrain migration retains its single undo checkpoint", async ({ page }) => {
  const legacy = terrainFixtures().flat;
  delete legacy.terrain!.generatorVersion;
  legacy.terrain!.patterns = { stairs: false, bridge: false, canopy: false };
  legacy.terrain!.tiles[0].height = 1;
  await openWorld(page, legacy);
  await expect.poll(async () => (await savedWorld(page)).terrain!.patterns.stairs).toBe(true);
  const undo = page.getByRole("button", { name: "되돌리기", exact: true });
  await undo.click();
  await expect.poll(async () => (await savedWorld(page)).terrain!.patterns.stairs).toBe(false);
  expect((await savedWorld(page)).terrain!.generatorVersion).toBe(2);
  await expect(undo).toBeDisabled();
  await page.getByRole("button", { name: "다시 실행", exact: true }).click();
  await expect.poll(async () => (await savedWorld(page)).terrain!.patterns.stairs).toBe(true);
  await expect(page.locator('[data-cell="0"]')).toHaveAccessibleName(/높이 1/);
});
