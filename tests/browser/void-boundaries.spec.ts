import { test, expect, type Page } from "@playwright/test";
import { createMeetingWorld, type MeetingMessage, type MeetingView } from "../../lib/meeting";
import { createMeetingCodec } from "../../lib/meeting-wire";
import { flatTerrain } from "../../lib/terrain";
import type { World } from "../../lib/world";
import { savedWorld } from "./world-storage";

test.setTimeout(150_000);

async function prepare(page: Page, world: World) {
  let view: MeetingView | undefined;
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("websocket", socket => {
    if (!socket.url().includes("/whistle/meeting?")) return;
    const codec = createMeetingCodec();
    socket.on("framereceived", ({ payload }) => {
      const message = codec.decode<MeetingMessage>(payload.toString());
      if (message?.type === "state") view = message.view;
      if (message?.type === "error") errors.push(message.message);
    });
  });
  await page.route(/\/components\/whistle\/Scene\.tsx(\?|$)/, async route => {
    const response = await route.fetch();
    const marker = "const portalScene = createPortalScene(world.size);";
    const source = await response.text();
    expect(source).toContain(marker);
    const body = source.replace(marker, `
      if (mode === "play") globalThis.__boundaryPose = (x, z, yaw) => {
        player.x = x; player.z = z; player.yaw = targetYaw = yaw;
      };
      ${marker}`).replace("pixelRenderer.render(scene, camera);", `
      if (mode === "play") {
        globalThis.__boundaryElapsed = (globalThis.__boundaryElapsed ?? 0) + dt;
        globalThis.__boundaryState = { x: player.x, z: player.z, falling: !!falling,
          elapsed: globalThis.__boundaryElapsed,
          ground: floorHeight(worldRef.current, player.x, player.z, structures) };
        if (falling) globalThis.__boundaryFalls = (globalThis.__boundaryFalls ?? 0) + 1;
      }
      pixelRenderer.render(scene, camera);`);
    await route.fulfill({ response, body });
  });
  await page.addInitScript(world => {
    Object.defineProperty(window, "devicePixelRatio", { value: .5 });
    localStorage.setItem("whistle.language", "ko");
    localStorage.setItem("whistle.world.v2", JSON.stringify(world));
  }, world);
  return { view: () => view!, errors };
}

async function ready(page: Page) {
  await page.bringToFront();
  await expect(page.locator("main")).toHaveAttribute("data-meeting-status", "online");
  await expect(page.locator(".live-preview canvas")).toHaveAttribute("data-ready", "true");
}
async function play(page: Page) {
  await page.bringToFront();
  await page.getByRole("button", { name: "플레이", exact: true }).click();
  await expect(page.locator(".play-shell canvas")).toHaveAttribute("data-ready", "true");
}
const pose = (page: Page, x: number, z: number, yaw: number) => page.evaluate(
  p => (globalThis as any).__boundaryPose(p.x, p.z, p.yaw), { x, z, yaw });
const state = (page: Page): Promise<{ x: number; z: number; falling: boolean; elapsed: number; ground: number | null }> =>
  page.evaluate(() => (globalThis as any).__boundaryState);
const falls = (page: Page) => page.evaluate(() => (globalThis as any).__boundaryFalls ?? 0);
async function advance(page: Page, seconds: number) {
  const end = (await state(page)).elapsed + seconds;
  await expect.poll(async () => (await state(page)).elapsed, { timeout: 20_000 }).toBeGreaterThanOrEqual(end);
}

test("two players stop at rounded void edges on desktop and mobile; only a hole causes falling", async ({ browser, baseURL }) => {
  const ca = await browser.newContext({ baseURL, viewport: { width: 640, height: 480 } });
  const cb = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
  const a = await ca.newPage(), b = await cb.newPage();
  const world = createMeetingWorld(17);
  world.timeOfDay = "noon";
  world.terrain!.tiles[(world.start.z - 1) * world.size + world.start.x].hole = true;
  const aa = await prepare(a, world), bb = await prepare(b, world);
  try {
    const url = `?meeting=void-corners-${Date.now()}`;
    await a.goto(url); await ready(a);
    await b.goto(url); await ready(b);
    await expect(a.locator(".presence-number")).toHaveText("2");
    for (const page of [a, b]) {
      await play(page);
      await pose(page, 19.34, 10.34, Math.PI * .75);
      await page.keyboard.down("KeyW");
      await advance(page, .4);
      const edge = await state(page);
      expect(edge.x).toBeGreaterThan(19.25);
      expect(edge.z).toBeGreaterThan(10.25);
      expect(edge.ground).not.toBeNull();
      await page.keyboard.press("Space");
      await advance(page, 1.1);
      await page.keyboard.up("KeyW");
      expect(await falls(page)).toBe(0);
      expect((await state(page)).ground).not.toBeNull();
      await pose(page, 19.4, 10.4, 0);
      await advance(page, .25);
      await expect.poll(async () => (await state(page)).ground).not.toBeNull();
      expect(await falls(page)).toBe(0);
      await pose(page, 19, 9.65, 0);
      await page.keyboard.down("KeyW");
      try { await expect.poll(() => falls(page)).toBeGreaterThan(0); }
      finally { await page.keyboard.up("KeyW"); }
      await page.keyboard.press("Escape");
    }
    expect([...aa.errors, ...bb.errors]).toEqual([]);
  } finally { await ca.close(); await cb.close(); }
});

test("crossing a lemon footing unlocks both editors and sharing; disconnect returns the visitor safely", async ({ browser, baseURL }, info) => {
  test.setTimeout(180_000);
  const ca = await browser.newContext({ baseURL, viewport: { width: 640, height: 480 } });
  const cb = await browser.newContext({ baseURL, viewport: { width: 640, height: 480 } });
  const cc = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
  const a = await ca.newPage(), b = await cb.newPage();
  const world = createMeetingWorld(17);
  world.terrain = { ...flatTerrain(world.size), floating: true };
  world.timeOfDay = "noon";
  const aa = await prepare(a, world), bb = await prepare(b, world);
  try {
    const url = `?meeting=void-footing-${Date.now()}`;
    await a.goto(url); await ready(a);
    await a.getByRole("button", { name: "장면 제목 입력", exact: true }).click();
    await a.getByRole("textbox", { name: "텍스트 입력", exact: true }).fill("건너갈 장면");
    await a.getByRole("button", { name: "저장", exact: true }).click();
    await play(a); await a.keyboard.press("Escape");
    await b.goto(url); await ready(b);
    await expect(b.locator('.workspace [data-turn]')).toHaveAttribute("data-turn", "other");
    await expect(b.locator('.received-material')).toHaveCount(0);
    await b.getByRole("button", { name: "장면 제목 입력", exact: true }).click();
    await b.getByRole("textbox", { name: "텍스트 입력", exact: true }).fill("연결 직후 보내는 장면");
    await b.getByRole("button", { name: "저장", exact: true }).click();
    await play(b);
    await expect.poll(() => bb.view()?.approaches.length).toBe(1);
    const outline = bb.view().approaches[0];
    await pose(b, 13.15, outline.z, -Math.PI / 2);
    await b.keyboard.down("KeyW");
    await advance(b, .6);
    await b.keyboard.up("KeyW");
    expect((await state(b)).x).toBeGreaterThanOrEqual(12.58);
    expect(await falls(b)).toBe(0);
    await b.keyboard.press("Escape");
    await expect(b.locator('.workspace [data-turn]')).toHaveAttribute("data-turn", "own", { timeout: 65_000 });
    await expect(b.getByRole("button", { name: "배치: 건너갈 장면", exact: true })).toBeVisible();
    await b.getByRole("button", { name: "배치: 건너갈 장면", exact: true }).click();
    await b.locator('[data-cell="126"]').click();
    await expect.poll(() => bb.view().connections.length).toBe(1);
    const gate = bb.view().connections[0];
    await expect(a.locator('.workspace [data-turn]')).toHaveAttribute("data-turn", "other");
    await play(b);
    await pose(b, 13.15, gate.z, -Math.PI / 2);
    await b.keyboard.down("KeyW");
    try { await expect.poll(async () => (await state(b)).x, { timeout: 10_000 }).toBeLessThan(11.3); }
    finally { await b.keyboard.up("KeyW"); }
    expect(bb.view().joined).toHaveLength(2);
    expect(await falls(b)).toBe(0);
    await b.keyboard.press("Escape");
    for (const [page, observed] of [[a, aa], [b, bb]] as const) {
      await expect(page.locator('.turn-status')).toHaveCount(0);
      await expect(page.getByRole("button", { name: "높이기", exact: true })).toHaveAttribute("aria-disabled", "false");
      await page.getByRole("button", { name: "높이기", exact: true }).click();
      await page.locator('[data-cell="0"]').click();
      await expect.poll(() => observed.view().ownWorld.terrain!.tiles[0].height).toBe(1);
      await page.getByRole("button", { name: "되돌리기", exact: true }).click();
      await expect.poll(() => observed.view().ownWorld.terrain!.tiles[0].height).toBe(0);
    }
    await expect(a.getByRole("button", { name: "배치: 연결 직후 보내는 장면", exact: true })).toBeVisible();
    const prompt = a.locator('[data-symbol-kind="image"][data-empty-symbol="true"]');
    await prompt.click();
    await a.getByRole("dialog").locator('input[type="file"]').setInputFiles({
      name: "after-connection.png", mimeType: "image/png",
      buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64"),
    });
    await a.getByRole("button", { name: "저장", exact: true }).click();
    await expect(b.locator('.received-material')).toHaveCount(2);
    await expect.poll(async () => (await savedWorld(b)).assets.filter(a => a.received).length).toBe(2);
    await expect(a.locator('.turn-status')).toHaveCount(0);
    await a.screenshot({ path: info.outputPath("connected-free-editor.png"), fullPage: true });
    await play(b);
    await pose(b, 11, gate.z, -Math.PI / 2);
    await advance(b, .25);
    await a.close();
    await expect.poll(() => bb.view().reset.reason).toBe("disconnect");
    await expect.poll(async () => (await state(b)).x).toBeCloseTo(12, 1);
    expect((await state(b)).ground).not.toBeNull();
    await pose(b, 12, gate.z, -Math.PI / 2);
    await b.keyboard.down("KeyW");
    await advance(b, .6);
    await b.keyboard.press("Space");
    await advance(b, 1.1);
    await b.keyboard.up("KeyW");
    expect((await state(b)).x).toBeGreaterThanOrEqual(11.58);
    expect((await state(b)).ground).not.toBeNull();
    expect(await falls(b)).toBe(0);
    await expect.poll(() => bb.view().connections.length).toBe(1);
    expect(bb.view().connections[0].online).toBe(false);
    const c = await cc.newPage(), observedC = await prepare(c, world);
    await c.goto(url); await ready(c);
    await expect.poll(() => bb.view().recipients.length).toBe(1);
    expect(bb.view().approaches).toHaveLength(0);
    expect(bb.view().connections[0].id).toBe(gate.id);
    expect((await state(b)).ground).not.toBeNull();
    await b.bringToFront();
    await pose(b, 12, gate.z, Math.PI / 2);
    await b.keyboard.down("KeyW");
    try { await expect.poll(async () => (await state(b)).x).toBeGreaterThan(13.1); }
    finally { await b.keyboard.up("KeyW"); }
    await expect.poll(() => bb.view().connections.length).toBe(0);
    await expect.poll(() => bb.view().approaches.length).toBe(1);
    expect((await state(b)).ground).not.toBeNull();
    expect(await falls(b)).toBe(0);
    await b.keyboard.press("Escape");
    await expect(b.locator('[data-connection]')).toHaveCount(0);
    await expect(b.locator('[data-approach-online="true"]')).toHaveCount(1);
    await expect.poll(async () => (await savedWorld(b)).connectionFootings?.length).toBe(1);
    await b.getByRole("button", { name: "멀티플레이", exact: true }).click();
    await expect(b.locator('[data-connection], [data-approach]')).toHaveCount(0);
    await expect.poll(async () => (await savedWorld(b)).connectionFootings?.length).toBe(0);
    await play(b);
    await expect.poll(async () => (await state(b)).ground).not.toBeNull();
    expect(await falls(b)).toBe(0);
    expect([...aa.errors, ...bb.errors, ...observedC.errors]).toEqual([]);
  } finally { await ca.close(); await cb.close(); await cc.close(); }
});
