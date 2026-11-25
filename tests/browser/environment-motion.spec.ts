import { atFixedStart } from "./fixed-start";
import { test, expect, type Page } from "@playwright/test";
import { terrainFixtures } from "../terrain-fixtures";
import { probePd, pdProbe, pdMessages } from "./pd-probe";
import type { World } from "../../lib/world";

test.setTimeout(90_000);
test.use({ viewport: { width: 520, height: 600 } });

async function enter(page: Page, world: World) {
  world=atFixedStart(world);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.addInitScript(world => {
    Object.defineProperty(window, "devicePixelRatio", { value: 0.5 });
    localStorage.setItem("whistle.world.v2", JSON.stringify(world));
    localStorage.setItem("whistle.language", "ko");
  }, world);
  await probePd(page);
  await page.goto(`?meeting=motion-${Date.now()}`);
  await expect(page.getByRole("button", { name: "파일 저장", exact: true })).toHaveAttribute("aria-description", "이 브라우저에 저장됨");
  await page.getByRole("button", { name: "플레이", exact: true }).click();
  await expect(page.locator(".play-shell canvas")).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
  return errors;
}
const motion = (page: Page) => page.locator(".play-shell canvas").getAttribute("data-motion");

for (const timeOfDay of ["noon", "midnight"] as const) {
  test(`updraft particles render in the pixel scene at ${timeOfDay}`, async ({ page }, testInfo) => {
    const world = terrainFixtures().flat; world.start = { x: 4, z: 5 };
    world.timeOfDay = timeOfDay;
    world.terrain!.tiles[5 * world.size + 4] = { height: 1, surface: "plain", hole: false };
    world.terrain!.tiles[4 * world.size + 4].hole = true;
    world.terrain!.tiles[3 * world.size + 4].height = 1;
    const errors = await enter(page, world);
    await page.waitForTimeout(700);
    await page.locator(".play-shell canvas").screenshot({ path: testInfo.outputPath(`updraft-${timeOfDay}-approach.png`) });
    await walkIntoFloat(page);
    await page.waitForTimeout(900);
    await page.locator(".play-shell canvas").screenshot({ path: testInfo.outputPath(`updraft-${timeOfDay}-inside.png`) });
    expect(errors).toEqual([]);
  });
}

test("wind keeps its sound but cannot push the player or turn a held jump into gliding", async ({ page }) => {
  const world = terrainFixtures().flat; world.start = { x: 3, z: 2 };
  for (let z = 0; z <= 2; z++) {
    world.terrain!.tiles[z * world.size + 3] = { height: 1, surface: "plain", hole: false };
    for (const x of [2, 4]) world.terrain!.tiles[z * world.size + x].height = 2;
  }
  const errors = await enter(page, world);
  await expect.poll(async () => (await pdProbe(page)).starts).toContain("environment_wind");
  const before = await position(page);
  await page.waitForTimeout(700);
  expect(await position(page)).toEqual(before);
  await page.getByRole("button", { name: "기어가기", exact: true }).click();
  await expect.poll(async () => (await pdMessages(page, "whistle-player stat")).at(-1)?.[0]).toBe(1);
  await page.getByRole("button", { name: "기어가기", exact: true }).click();
  await recordMotion(page);
  await page.keyboard.down("KeyW"); await page.keyboard.down("Space");
  await expect.poll(() => motion(page)).toBe("jump");
  await page.keyboard.up("KeyW");
  await expect.poll(() => motion(page), { timeout: 5000 }).toBe("walk");
  await page.keyboard.up("Space");
  expect(await recordedMotion(page)).not.toContain("glide");
  expect(errors).toEqual([]);
});

test("opposing raised banks around a hole supports floating, crouch releases it", async ({ page }, testInfo) => {
  const world = terrainFixtures().flat; world.start = { x: 4, z: 5 };
  world.terrain!.tiles[5 * world.size + 4] = { height: 1, surface: "plain", hole: false };
  world.terrain!.tiles[4 * world.size + 4].hole = true;
    world.terrain!.tiles[3 * world.size + 4].height = 1;
  const errors = await enter(page, world);
  await walkIntoFloat(page);
  await page.locator(".play-shell canvas").evaluate(canvas => new Promise<void>(resolve => {
    const nextPosition = new MutationObserver(() => {
      nextPosition.disconnect();
      resolve();
    });
    nextPosition.observe(canvas, { attributes: true, attributeFilter: ["data-player-z"] });
  }));
  const floating = await position(page);
  await page.waitForTimeout(400);
  expect(await position(page)).toEqual(floating);
  await page.screenshot({ path: testInfo.outputPath("floating.png") });
  await page.getByRole("button", { name: "기어가기", exact: true }).click();
  await expect.poll(() => motion(page), { timeout: 5000 }).toBe("fall");
  expect(errors).toEqual([]);
});

test("movement keys leave a rotating updraft and return to walking", async ({ page }) => {
  const world = terrainFixtures().flat; world.start = { x: 4, z: 5 };
  world.terrain!.tiles[5 * world.size + 4] = { height: 1, surface: "plain", hole: false };
  world.terrain!.tiles[4 * world.size + 4].hole = true;
    world.terrain!.tiles[3 * world.size + 4].height = 1;
  const errors = await enter(page, world);
  await walkIntoFloat(page);
  await page.waitForTimeout(2000);
  expect(await motion(page)).toBe("float");
  await page.keyboard.down("KeyW");
  await expect.poll(() => motion(page), { timeout: 5000 }).toBe("walk");
  await page.keyboard.up("KeyW");
  expect(errors).toEqual([]);
});

test("a planted bowl does not bounce and direct jumping still works", async ({ page }) => {
  const world = terrainFixtures().flat; world.start = { x: 4, z: 5 };
  world.terrain!.tiles[5 * world.size + 4].surface = "soft";
  world.terrain!.tiles[5 * world.size + 3] = { height: 1, surface: "soft", hole: false };
  world.terrain!.tiles[5 * world.size + 5] = { height: 1, surface: "soft", hole: false };
  world.terrain!.tiles[6 * world.size + 4].height = 1;
  const errors = await enter(page, world);
  await recordMotion(page);
  const before = await position(page);
  await page.keyboard.down("KeyW");
  await expect.poll(async () => (await position(page)).z).toBeLessThan(before.z - .15);
  await page.keyboard.up("KeyW");
  expect(await recordedMotion(page)).not.toContain("bounce");
  await page.getByRole("button", { name: "점프", exact: true }).click();
  await expect.poll(() => motion(page)).toBe("jump");
  await expect.poll(() => motion(page), { timeout: 5000 }).toBe("walk");
  expect(errors).toEqual([]);
});

test("downhill flow keeps its sound but cannot push or slide a stopped player", async ({ page }) => {
  const world = terrainFixtures().flat; world.start = { x: 4, z: 5 };
  for (const [x, height] of [[3, 2], [4, 1], [5, 0]]) {
    world.terrain!.tiles[5 * world.size + x] = { height, surface: "slick", hole: false };
  }
  const errors = await enter(page, world);
  await expect.poll(async () => (await pdProbe(page)).starts).toContain("terrain_slick");
  const before = await position(page);
  await page.waitForTimeout(700);
  expect(await position(page)).toEqual(before);
  await page.keyboard.down("KeyW");
  await expect.poll(async () => (await position(page)).z, { intervals: [20] }).toBeLessThan(before.z - .1);
  await page.keyboard.up("KeyW");
  await page.waitForTimeout(150);
  const stopped = await position(page);
  await page.waitForTimeout(700);
  const after = await position(page);
  expect(after.x).toBeCloseTo(stopped.x, 4);
  expect(after.z).toBeCloseTo(stopped.z, 4);
  expect(errors).toEqual([]);
});

const position = (page: Page) => page.locator(".play-shell canvas").evaluate(canvas => ({
  x: Number((canvas as HTMLElement).dataset.playerX), z: Number((canvas as HTMLElement).dataset.playerZ),
}));
async function recordMotion(page: Page) {
  await page.locator(".play-shell canvas").evaluate(canvas => {
    const states: string[] = [];
    (window as unknown as { motionStates: string[] }).motionStates = states;
    new MutationObserver(() => states.push((canvas as HTMLElement).dataset.motion!))
      .observe(canvas, { attributes: true, attributeFilter: ["data-motion"] });
  });
}
const recordedMotion = (page: Page) => page.evaluate(() => (window as unknown as { motionStates: string[] }).motionStates);

async function walkIntoFloat(page: Page) {
  await expect.poll(() => motion(page)).toBe("walk");
  const start = await position(page);
  await page.keyboard.down("KeyW");
  await expect.poll(async () => (await position(page)).z, { intervals: [20], timeout: 5000 }).toBeLessThan(start.z - .85);
  await page.keyboard.up("KeyW");
  await expect.poll(() => motion(page)).toBe("float");
}
