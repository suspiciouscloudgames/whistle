import { test, expect, type Page } from "@playwright/test";
import { gzipSync } from "node:zlib";
import { starterWorld, type World } from "../../lib/world";
import { flatTerrain } from "../../lib/terrain";

const STORAGE = "whistle.world.v2";
const LEGACY_STORAGE = "whistle.world.v1";
function savedWorld(): World {
  const world = starterWorld();
  world.title = "보존할 세계";
  world.terrain = flatTerrain(world.size);
  return world;
}
async function open(page: Page, stored?: string, hash = "", key = STORAGE) {
  // Seed only once so a reload cannot hide an accidental overwrite.
  await page.goto(".");
  await expect(page.getByRole("button", { name: "공유", exact: true }))
    .toHaveAttribute("aria-description", "이 브라우저에 저장됨");
  await page.evaluate(({ key, stored }) => {
    localStorage.clear();
    localStorage.setItem("whistle.language", "ko");
    if (stored !== undefined) localStorage.setItem(key, stored);
  }, { key, stored });
  // Start a new document; changing only the hash would exercise hashchange instead.
  await page.goto("about:blank");
  await page.goto(`./${hash}`);
}
async function storedValue(page: Page, key = STORAGE) {
  return page.evaluate((key) => localStorage.getItem(key), key);
}
async function expectPreserved(page: Page, original: string | null, key = STORAGE) {
  // Observe beyond the 350ms autosave debounce, including subsequent edits.
  await page.waitForTimeout(800);
  expect(await storedValue(page, key)).toBe(original);
}

for (const hash of ["#world=invalid", "#world=zAA", "#world="]) {
  test(`invalid shared link preserves an existing world: ${hash}`, async ({ page }) => {
    const original = JSON.stringify(savedWorld());
    await open(page, original, hash);
    await expectPreserved(page, original);
    await page.getByRole("button", { name: "높이기", exact: true }).click();
    await page.locator("[data-cell='0']").click();
    await expectPreserved(page, original);
  });
}

for (const original of ["{broken-json", "", JSON.stringify({ ...savedWorld(), version: 99 })]) {
  test(`unreadable stored data is preserved: ${original.slice(0, 25)}`, async ({ page }) => {
    await open(page, original);
    await expectPreserved(page, original);
  });
}

test("a failed legacy load preserves the old data and creates no v2 save", async ({ page }) => {
  await open(page, "{broken-legacy", "", LEGACY_STORAGE);
  await expectPreserved(page, "{broken-legacy", LEGACY_STORAGE);
  expect(await storedValue(page)).toBeNull();
});

test("normal loading and editing still autosave", async ({ page }) => {
  await open(page, JSON.stringify(savedWorld()));
  await page.getByRole("button", { name: "높이기", exact: true }).click();
  await page.locator("[data-cell='0']").click();
  await expect.poll(async () => JSON.parse((await storedValue(page))!).terrain.tiles[0].height).toBe(1);
  expect(JSON.parse((await storedValue(page))!).title).toBe("보존할 세계");
});

test("a first visit creates a save", async ({ page }) => {
  await open(page);
  await expect.poll(() => storedValue(page)).not.toBeNull();
});

test("a valid file import resumes saving after a failed load", async ({ page }) => {
  await open(page, "{broken-json", "#world=invalid");
  const imported = { ...savedWorld(), title: "가져온 세계" };
  await page.locator("input[type=file]").setInputFiles({
    name: "world.whistle.json", mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(imported)),
  });
  await expect.poll(() => storedValue(page)).toBe(JSON.stringify(imported));
  expect(new URL(page.url()).hash).toBe("");
  await page.reload();
  await expect(page.getByRole("button", { name: "공유", exact: true }))
    .toHaveAttribute("aria-description", "이 브라우저에 저장됨");
  expect(await storedValue(page)).toBe(JSON.stringify(imported));
});

test("an invalid file import does not unlock autosave after a failed load", async ({ page }) => {
  await open(page, "{broken-json");
  await page.locator("input[type=file]").setInputFiles({
    name: "bad.json", mimeType: "application/json", buffer: Buffer.from("{}"),
  });
  await expectPreserved(page, "{broken-json");
});

test("explicitly starting over resumes saving after a failed load", async ({ page }) => {
  await open(page, "{broken-json", "#world=invalid");
  await page.getByRole("button", { name: "다시 시작", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "다시 시작", exact: true }).click();
  await expect.poll(() => storedValue(page)).not.toBe("{broken-json");
  expect(JSON.parse((await storedValue(page))!).terrain).toBeDefined();
  expect(new URL(page.url()).hash).toBe("");
});

test("a valid compressed shared world still loads and saves", async ({ page }) => {
  const incoming = { ...savedWorld(), title: "공유된 세계" };
  const encoded = "z" + gzipSync(JSON.stringify(incoming)).toString("base64url");
  await open(page, JSON.stringify(savedWorld()), `#world=${encoded}`);
  await expect.poll(() => storedValue(page)).toBe(JSON.stringify(incoming));
  expect(new URL(page.url()).hash).toBe("");
});

test("a failed hashchange pauses an already active autosave", async ({ page }) => {
  const original = JSON.stringify(savedWorld());
  await open(page, original);
  await expect(page.getByRole("button", { name: "공유", exact: true }))
    .toHaveAttribute("aria-description", "이 브라우저에 저장됨");
  await page.evaluate(() => { location.hash = "world=invalid"; });
  await expect(page.getByRole("button", { name: "공유", exact: true }))
    .toHaveAttribute("aria-description", "불러오기 실패 · 자동 저장 중지");
  await page.getByRole("button", { name: "높이기", exact: true }).click();
  await page.locator("[data-cell='0']").click();
  await expectPreserved(page, original);
});
