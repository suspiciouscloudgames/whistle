import { savedWorld } from "./world-storage";
import { test, expect, type Page } from "@playwright/test";
import { terrainFixtures } from "../terrain-fixtures";
import { withEmptyContent } from "./content-fixture";

test.setTimeout(60_000);

async function openMedia(page: Page, kind: "image" | "text" = "image") {
  const world = withEmptyContent(terrainFixtures().flat, kind);
  for (let z = 1; z <= 3; z++) for (let x = 1; x <= 3; x++) world.terrain!.tiles[z * world.size + x].surface = "soft";
  world.terrain!.tiles[9 * world.size + 9].height = 2;
  await page.addInitScript(world => {
    if (localStorage.getItem("media-ready")) return;
    localStorage.setItem("whistle.world.v2", JSON.stringify(world));
    localStorage.setItem("whistle.language", "ko");
    localStorage.setItem("media-ready", "1");
  }, world);
  await page.goto(".");
  await expect(page.getByRole("button", { name: "파일 저장", exact: true }))
    .toHaveAttribute("aria-description", "이 브라우저에 저장됨");
  await page.getByRole("button", { name: kind === "image" ? "이미지 입력" : "텍스트 입력", exact: true }).click();
}

const savedAssets = async(page:Page) => (await savedWorld(page)).assets;

test("large photos are compressed with transparency and without a duplicate original", async ({ page }) => {
  await openMedia(page);
  const source = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1600;
    canvas.height = 1000;
    const ctx = canvas.getContext("2d")!;
    const image = ctx.createImageData(canvas.width, canvas.height);
    let seed = 123;
    for (let i = 0; i < image.data.length; i += 4) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      image.data[i] = seed & 255;
      image.data[i + 1] = (seed >>> 8) & 255;
      image.data[i + 2] = (seed >>> 16) & 255;
      image.data[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    return canvas.toDataURL("image/png");
  });
  const file = Buffer.from(source.split(",")[1], "base64");
  expect(file.length).toBeGreaterThan(1_000_000);
  await page.getByRole("dialog").locator('input[type="file"]').setInputFiles({
    name: "large-photo.png", mimeType: "image/png", buffer: file,
  });
  await expect(page.getByRole("button", { name: "저장", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect.poll(async () => (await savedAssets(page)).some(a => !!a.image)).toBe(true);
  const asset = (await savedAssets(page)).find(a => a.image)!;
  expect(Buffer.from(asset.image!.split(",")[1], "base64").length).toBeLessThanOrEqual(64 * 1024);
  expect(asset.originalImage).toBeUndefined();
  const decoded = await page.evaluate(async src => {
    const image = new Image();
    image.src = src;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(image, 0, 0);
    return { width: image.width, height: image.height,
      cornerAlpha: ctx.getImageData(0, 0, 1, 1).data[3],
      centerAlpha: ctx.getImageData(image.width / 2, image.height / 2, 1, 1).data[3] };
  }, asset.image!);
  expect(decoded.width).toBeLessThanOrEqual(256);
  expect(decoded.height).toBeLessThanOrEqual(256);
  expect(decoded.cornerAlpha).toBe(0);
  expect(decoded.centerAlpha).toBe(255);
  await page.reload();
  await expect(page.getByRole("button", { name: "파일 저장", exact: true }))
    .toHaveAttribute("aria-description", "이 브라우저에 저장됨");
  expect((await savedAssets(page)).find(a => a.image)?.image).toBe(asset.image);
});

test("native paste preserves long text without clipboard buttons", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openMedia(page, "text");
  const input = page.getByRole("textbox", { name: "텍스트 입력" });
  await page.evaluate(() => navigator.clipboard.writeText("복사한 문장\n두 번째 줄"));
  await input.focus();
  await input.press("ControlOrMeta+V");
  await expect(input).toHaveValue("복사한 문장\n두 번째 줄");
  await expect(page.getByRole("dialog").getByRole("button", { name: /^(복사|붙여넣기)$/ })).toHaveCount(0);
  const content = "  가나다 Whistle 😀\n두 번째 문단\n\n".repeat(500).slice(0, 10_000);
  await page.evaluate(value => navigator.clipboard.writeText(value), content);
  await input.focus();
  await input.press("ControlOrMeta+A");
  await input.press("ControlOrMeta+V");
  await expect(input).toHaveValue(content);
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect.poll(async () => (await savedAssets(page)).find(a => a.text)?.text).toBe(content);
  const asset = (await savedAssets(page)).find(a => a.text)!;
  expect(asset.image!.length).toBeLessThanOrEqual(400_000);
  await page.reload();
  await expect(page.getByRole("button", { name: "파일 저장", exact: true }))
    .toHaveAttribute("aria-description", "이 브라우저에 저장됨");
  await page.locator("[data-symbol-asset]").click();
  await page.getByRole("button", { name: "편집", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "텍스트 입력" })).toHaveValue(content);
});

test("oversized text remains editable without truncation", async ({ page }) => {
  await openMedia(page, "text");
  const input = page.getByRole("textbox", { name: "텍스트 입력" });
  const content = "가".repeat(10_001);
  await input.fill(content);
  await expect(input).toHaveValue(content);
  await expect(page.getByRole("button", { name: "저장", exact: true })).toBeDisabled();
  await expect(page.getByRole("alert")).toContainText("10,000자");
  await input.fill("수정한 텍스트");
  await expect(page.getByRole("button", { name: "저장", exact: true })).toBeEnabled();
});
