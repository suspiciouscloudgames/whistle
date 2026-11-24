import { savedWorld } from "./world-storage";
import { test, expect } from "@playwright/test";
import { terrainFixtures } from "../terrain-fixtures";
import type { World } from "../../lib/world";

for (const [kind, label] of [["image", "이미지"], ["text", "텍스트"], ["sound", "사운드"]] as const) {
  test(`${kind} shares delete/save controls and keeps placement deletion separate and undoable`, async ({ page }) => {
    if (kind === "text") await page.setViewportSize({ width: 390, height: 844 });
    const world = terrainFixtures().flat;
    world.workshop = {id: "completed-content", serial: 0, next: 0, pending: []};
    const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9l0AAAAASUVORK5CYII=";
    world.assets.push({ id: "media", name: "sample", shape: "sphere", color: "#111111", solid: false,
      ...(kind === "sound" ? { sound: { data: "data:audio/wav;base64,AAAA", duration: 1, mode: "loop" as const, volume: 0.7 } }
        : { image, ...(kind === "text" ? { text: "글" } : {}) }) });
    world.objects = [0, 1].map(x => ({ id: `placed-${x}`, asset: "media", x, z: 0, scale: 1, rotation: 0 }));
    world.rules = [{ id: "media-rule", subject: "media", source: "*", trigger: "gaze", action: "mark", token: "", result: "별", replacement: "media", radius: 3, enabled: true }];
    await page.addInitScript(world => {
      localStorage.setItem("whistle.world.v2", JSON.stringify(world));
      localStorage.setItem("whistle.language", "ko");
    }, world);
    await page.goto(".");
    const saved = () => savedWorld(page);
    await expect(page.locator("[data-symbol-site]")).toHaveCount(2);
    await page.locator('[data-cell="0"] [data-symbol-site]').click();
    const footer = page.getByRole("dialog").locator(".dialog-footer");
    await expect(footer.getByRole("button")).toHaveText(["배치 삭제", "저장"]);
    await footer.getByRole("button", { name: "배치 삭제" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect.poll(async () => (await saved()).objects.map(o => o.id)).toEqual(["placed-1"]);
    expect((await saved()).assets.filter(a => a.id === "media")).toHaveLength(1);
    expect((await saved()).rules).toHaveLength(1);
    await page.getByRole("button", { name: "되돌리기", exact: true }).click();
    await expect(page.locator("[data-symbol-site]")).toHaveCount(2);
    await page.locator('[data-symbol-asset="media"]').click();
    await page.getByRole("button", { name: "편집", exact: true }).click();
    await expect(footer.getByRole("button")).toHaveText([`${label} 삭제`, "저장"]);
    await expect(footer.locator("button.primary")).toHaveText("저장");
    for (const [size, viewport] of [["desktop", { width: 1280, height: 900 }], ["mobile", { width: 390, height: 844 }], ["small", { width: 320, height: 568 }]] as const) {
      await page.setViewportSize(viewport);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const dialog = page.getByRole("dialog");
      const bounds = await dialog.boundingBox();
      const actions = await footer.boundingBox();
      expect(bounds!.height).toBeLessThan(viewport.height - 20);
      expect(actions!.y + actions!.height).toBeLessThan(viewport.height);
      await dialog.screenshot({ path: `/tmp/whistle-makers/${kind}-${size}.png` });
    }
    await footer.getByRole("button", { name: `${label} 삭제` }).click();
    await expect.poll(async () => (await saved()).assets.some(a => a.id === "media")).toBe(false);
    expect((await saved()).objects).toHaveLength(0);
    expect((await saved()).rules).toHaveLength(0);
    await page.getByRole("button", { name: "되돌리기", exact: true }).click();
    await expect.poll(async () => (await saved()).objects.length).toBe(2);
    expect((await saved()).rules).toHaveLength(1);
    await expect(page.getByRole("button", { name: `${label} 만들기`, exact: true })).toHaveCount(0);
  });
}
