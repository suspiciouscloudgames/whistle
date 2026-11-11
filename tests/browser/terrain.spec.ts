import { test, expect, type Page } from "@playwright/test";
import { terrainFixtures } from "../terrain-fixtures";
import type { World } from "../../lib/world";
import ts from "typescript";

test.setTimeout(60_000);

async function openWorld(page: Page, world: World) {
  await page.route(/\/(components\/whistle\/TerrainScene|lib\/environment)\.ts(\?|$)/, async (route) => {
    const response = await route.fetch();
    let source = await response.text();
    const tree = ts.createSourceFile("module.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    for (const node of [...tree.statements].reverse()) {
      if (!ts.isFunctionDeclaration(node) || !node.body || !node.name) continue;
      const name = node.name.text;
      if (!["makeTerrain", "deriveEnvironment"].includes(name)) continue;
      const at = node.body.getStart(tree) + 1;
      source = source.slice(0, at) + `globalThis.__terrainCounts ??= {}; globalThis.__terrainCounts.${name} = (globalThis.__terrainCounts.${name} ?? 0) + 1;` + source.slice(at);
    }
    await route.fulfill({ response, body: source });
  });
  await page.addInitScript((world) => {
    localStorage.setItem("whistle.world.v2", JSON.stringify(world));
    localStorage.setItem("whistle.language", "ko");
  }, world);
  await page.goto(".");
  await page.locator(".live-preview canvas").waitFor();
  await frames(page);
}

async function frames(page: Page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function counts(page: Page) {
  return page.evaluate(() => (globalThis as typeof globalThis & {
    __terrainCounts: { makeTerrain: number; deriveEnvironment: number };
  }).__terrainCounts);
}

test("initial terrain is built once; an unrelated symbol preserves it", async ({ page }) => {
  await openWorld(page, terrainFixtures().flat);
  const initial = await counts(page);
  expect(initial.makeTerrain).toBe(1);
  await page.getByRole("button", { name: "기호", exact: true }).click();
  await page.locator('[data-cell="96"]').click();
  await frames(page);
  expect(await counts(page)).toEqual(initial);
  await expect(page.locator('[data-cell="96"] .placed-art')).toHaveCount(1);
});

test("unchanged paint keeps history empty; a real edit shares one environment calculation", async ({ page }) => {
  await openWorld(page, terrainFixtures().flat);
  const initial = await counts(page);
  const cell = page.locator('[data-cell="0"]');
  const box = (await cell.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (const dx of [8, 9, 10, 8]) {
    await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2);
    await frames(page);
  }
  await page.mouse.up();
  expect(await counts(page)).toEqual(initial);
  await expect(page.getByRole("button", { name: "되돌리기", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "높이기", exact: true }).click();
  await cell.click();
  await frames(page);
  expect(await counts(page)).toEqual({ makeTerrain: initial.makeTerrain + 1, deriveEnvironment: initial.deriveEnvironment + 1 });
  await expect(cell).toHaveAccessibleName(/높이 1/);
  await page.getByRole("button", { name: "되돌리기", exact: true }).click();
  await frames(page);
  await expect(cell).toHaveAccessibleName(/높이 0/);
  expect((await counts(page)).deriveEnvironment).toBe(initial.deriveEnvironment + 1);
  await page.getByRole("button", { name: "다시 실행", exact: true }).click();
  await frames(page);
  await expect(cell).toHaveAccessibleName(/높이 1/);
  expect((await counts(page)).deriveEnvironment).toBe(initial.deriveEnvironment + 1);
});

test("placing and removing a bridge endpoint rebuilds the terrain", async ({ page }) => {
  const world = terrainFixtures().flat;
  world.terrain!.tiles[123].hole = true;
  world.objects.push({ id: "endpoint", asset: "circle", x: 2, z: 10, rotation: 0, scale: 1 });
  await openWorld(page, world);
  const initial = await counts(page);
  await page.getByRole("button", { name: "기호", exact: true }).click();
  await page.locator('[data-cell="124"]').click();
  await frames(page);
  await expect(page.locator('[data-cell="123"] .generated-bridge')).toHaveCount(1);
  expect((await counts(page)).makeTerrain).toBe(initial.makeTerrain + 1);
  await page.getByRole("button", { name: "되돌리기", exact: true }).click();
  await frames(page);
  await expect(page.locator('[data-cell="123"] .generated-bridge')).toHaveCount(0);
  expect((await counts(page)).makeTerrain).toBe(initial.makeTerrain + 2);
});

test("a stroke that starts with an unchanged tile still undoes as one edit", async ({ page }) => {
  const world = terrainFixtures().flat;
  world.terrain!.tiles[0].height = 6;
  await openWorld(page, world);
  await page.getByRole("button", { name: "높이기", exact: true }).click();
  const first = (await page.locator('[data-cell="0"]').boundingBox())!;
  await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(first.x + first.width / 2 + 8, first.y + first.height / 2);
  await frames(page);
  for (const i of [1, 2]) {
    const box = (await page.locator(`[data-cell="${i}"]`).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await frames(page);
  }
  await page.mouse.up();
  await expect(page.locator('[data-cell="0"]')).toHaveAccessibleName(/높이 6/);
  await expect(page.locator('[data-cell="1"]')).toHaveAccessibleName(/높이 1/);
  await expect(page.locator('[data-cell="2"]')).toHaveAccessibleName(/높이 1/);
  await page.getByRole("button", { name: "되돌리기", exact: true }).click();
  await expect(page.locator('[data-cell="0"]')).toHaveAccessibleName(/높이 6/);
  await expect(page.locator('[data-cell="1"]')).toHaveAccessibleName(/높이 0/);
  await expect(page.locator('[data-cell="2"]')).toHaveAccessibleName(/높이 0/);
  await expect(page.getByRole("button", { name: "되돌리기", exact: true })).toBeDisabled();
});
