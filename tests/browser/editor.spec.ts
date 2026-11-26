import { test, expect } from "@playwright/test";
import { terrainFixtures } from "../terrain-fixtures";

test.beforeEach(async ({ page }) => {
  await page.addInitScript((world) => {
    localStorage.setItem("whistle.world.v2", JSON.stringify(world));
    localStorage.setItem("whistle.language", "ko");
  }, terrainFixtures().flat);
  await page.goto(".");
  await expect(page.getByRole("button", { name: "파일 저장", exact: true }))
    .toHaveAttribute("aria-description", "이 브라우저에 저장됨");
});

test("toolbar and palette keep language, dialogs, and file selection connected", async ({ page }) => {
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Raise", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "한국어", exact: true }).click();
  await expect(page.getByRole("button", { name: "공유", exact: true })).toHaveCount(0);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "파일 저장", exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/\.whistle\.json$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "다시 시작", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("현재 작업이 삭제됩니다.");
  await page.getByRole("dialog").getByRole("button", { name: "닫기", exact: true }).click();
  await page.getByRole("button", { name: "높이기", exact: true }).click();
  await page.locator('[data-cell="0"]').click();
  await page.locator('[data-cell="0"]').click();
  await page.getByRole("button", { name: "장면 제목 입력", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("textbox", { name: "텍스트 입력" }).fill("처음 자리");
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await page.getByRole("button", {name: "배치: 처음 자리", exact: true}).click();
  await page.locator('[data-cell="0"]').click();
  await expect(page.locator('[data-cell="0"] [data-symbol-site] g')).toHaveAttribute("fill", "currentColor");
  await expect(page.getByRole("button", { name: "시작점", exact: true })).toHaveCount(0);
  await expect(page.locator('[data-cell="126"]')).toHaveAccessibleName(/시작점/);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "불러오기", exact: true }).click();
  const imported = terrainFixtures().flat;
  imported.terrain!.tiles[0].height = 2;
  await (await chooser).setFiles({
    name: "world.whistle.json", mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(imported)),
  });
  await expect(page.locator('[data-cell="0"]')).toHaveAccessibleName(/높이 2/);
});

for (const [name, viewport] of Object.entries({
  desktop: { width: 1280, height: 900 },
  mobile: { width: 390, height: 844 },
})) {
  test(`play controls and return preserve editor state and focus: ${name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const grid = page.getByRole("group", { name: "격자" });
    const startMarker = grid.getByRole("button", { name: /^G11 .*시작점/ }).locator(".start-marker");
    await expect(startMarker).toBeVisible();
    await expect(grid.locator(".start-marker")).toHaveCount(1);
    await expect(grid.locator(".meeting-map-player")).toHaveCount(0);
    await page.getByRole("button", { name: "높이기", exact: true }).click();
    await page.locator('[data-cell="0"]').click();
    await page.evaluate(() => {
      (window as Window & { boardBefore?: Element | null }).boardBefore = document.querySelector(".canvas-panel");
    });
    await page.getByRole("button", { name: "플레이", exact: true }).click();
    const canvas = page.locator(".play-shell canvas");
    await expect(canvas).toHaveAttribute("data-ready", "true");
    const startZ = Number(await canvas.getAttribute("data-player-z"));
    await page.keyboard.down("KeyW");
    try {
      await expect.poll(async () => Number(await canvas.getAttribute("data-player-z"))).toBeLessThan(startZ - .6);
    } finally {
      await page.keyboard.up("KeyW");
    }
    await expect(page.locator(".workspace")).toBeHidden();
    await page.getByRole("button", { name: "기어가기", exact: true }).click();
    await expect(page.getByRole("button", { name: "기어가기", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(page.locator(".workspace")).toBeVisible();
    await expect(startMarker).toBeVisible();
    await expect(grid.locator(".meeting-map-player")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "만들기", exact: true })).toBeFocused();
    expect(await page.evaluate(() => (window as Window & { boardBefore?: Element | null }).boardBefore === document.querySelector(".canvas-panel"))).toBe(true);
    await expect(page.locator('[data-cell="0"]')).toHaveAccessibleName(/높이 1/);
    await expect(page.getByRole("button", { name: "높이기", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "플레이", exact: true }).click();
    await expect(page.getByRole("button", { name: "기어가기", exact: true })).toHaveAttribute("aria-pressed", "false");
    await page.getByRole("button", { name: "만들기로 돌아가기", exact: true }).click();
    await expect(page.getByRole("button", { name: "만들기", exact: true })).toBeFocused();
    await page.getByRole("button", { name: "되돌리기", exact: true }).click();
    await expect(page.locator('[data-cell="0"]')).toHaveAccessibleName(/높이 0/);
  });
}
