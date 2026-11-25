import { test, expect, type Browser, type Page, type WebSocketRoute } from "@playwright/test";
import { createMeetingWorld } from "../../lib/meeting";
import { terrainFixtures } from "../terrain-fixtures";
import { savedWorld } from "./world-storage";

const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
test.setTimeout(210_000);

async function instrument(page: Page) {
  await page.addInitScript(() => {
    (window as any).__mp = { positions: 0, bytes: 0, renders: 0, frames: 0, shadows: 0, whistles: [], errors: [] };
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function(data) {
      if (typeof data === "string") {
        const message = JSON.parse(data);
        if (message.type === "position") (window as any).__mp.positions++;
        (window as any).__mp.bytes += data.length;
      }
      return send.call(this, data);
    };
  });
  await page.route(/\/components\/whistle\/useMeetingRoom\.ts(\?|$)/, async route => {
    const response = await route.fetch(), source = await response.text();
    const body = source.replace("if (!message) return;", `if (!message) return;
      if (message.type === 'state') globalThis.__mp.view = message.view;
      if (message.presence) globalThis.__mp.presence = message.presence;
      if (message.type === 'whistle') globalThis.__mp.whistles.push(message.whistle);
      if (message.type === 'error') globalThis.__mp.errors.push(message.message);`);
    expect(body).not.toBe(source);
    await route.fulfill({ response, body });
  });
  await page.route(/\/app\/page\.tsx(\?|$)/, async route => {
    const response = await route.fetch(), source = await response.text();
    await route.fulfill({ response, body: source.replace("const { t } = useLanguage();", "globalThis.__mp.renders++; const { t } = useLanguage();") });
  });
  await page.route(/\/components\/whistle\/Scene\.tsx(\?|$)/, async route => {
    const response = await route.fetch(), source = await response.text();
    const body = source.replace("const keys = new Set();", `const keys = new Set();
      globalThis.__testPlayer = player;
      globalThis.__placePlayer = p => { Object.assign(player, p, { falling: false, grounded: true });
        targetYaw = p.yaw; jump = air = falling = null; respawnFade = 0; lastGround = 0; report = 0; };`)
      .replace("const elapsed = time - last;", "if (time - last < (globalThis.__mp.frameInterval ?? 0)) { frame = requestAnimationFrame(render); return; } const elapsed = time - last;")
      .replace("renderer.shadowMap.needsUpdate = true;", "renderer.shadowMap.needsUpdate = true; globalThis.__mp.shadows++;")
      .replace("pixelRenderer.render(scene, camera);", "pixelRenderer.render(scene, camera); globalThis.__mp.frames++;");
    expect(body).toContain("globalThis.__placePlayer");
    await route.fulfill({ response, body });
  });
}
const state = (page: Page) => page.evaluate(() => (window as any).__mp);
const position = (page: Page) => page.locator('.play-shell canvas').evaluate(canvas => {
  const el = canvas as HTMLElement;
  return { x: Number(el.dataset.playerX), z: Number(el.dataset.playerZ), motion: el.dataset.motion };
});
async function ready(page: Page) {
  await page.bringToFront();
  await expect(page.locator('main')).toHaveAttribute('data-meeting-status', 'online', { timeout: 30_000 });
  await expect(page.getByRole('button', { name: '파일 저장', exact: true })).toHaveAttribute('aria-description', '이 브라우저에 저장됨', { timeout: 30_000 });
}
async function play(page: Page) {
  await page.bringToFront();
  await page.getByRole('button', { name: '플레이', exact: true }).click();
  await expect(page.locator('.play-shell canvas')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
}
async function placePlayer(page: Page, x: number, z: number, yaw: number) {
  await page.bringToFront();
  await page.evaluate(p => (window as any).__placePlayer(p), { x, z, yaw });
  await expect.poll(async () => (await position(page)).x).toBeCloseTo(x, 1);
}
async function forwardTo(page: Page, x: number, direction: 'left' | 'right') {
  await page.bringToFront();
  await page.keyboard.down('w');
  try {
    await expect.poll(async () => (await position(page)).x, { timeout: 20_000, intervals: [80] })[direction === 'left' ? 'toBeLessThan' : 'toBeGreaterThan'](x);
  } finally { await page.keyboard.up('w'); }
}
async function player(browser: Browser, baseURL: string | undefined, label: string, mobile = false, complex = false) {
  const context = await browser.newContext({ baseURL, locale: 'ko-KR', viewport: mobile ? { width: 390, height: 844 } : { width: 640, height: 700 },
    isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
  const page = await context.newPage(), errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const world = createMeetingWorld(29);
  world.timeOfDay = 'noon';
  world.terrain!.tiles = world.terrain!.tiles.map(() => ({ height: 0, surface: 'plain' }));
  if (complex) { world.terrain = terrainFixtures().mixed.terrain; world.weather = "rain"; }
  const title = world.assets.findIndex(asset => asset.prompt?.title);
  world.assets[title] = { ...world.assets[title], name: label, text: label, image: png };
  world.title = label;
  await page.addInitScript(world => {
    if (!localStorage.getItem('multiplayer-test-seeded')) {
      localStorage.setItem('whistle.world.v2', JSON.stringify(world));
      localStorage.setItem('multiplayer-test-seeded', '1');
    }
    localStorage.setItem('whistle.language', 'ko');
  }, world);
  await instrument(page);
  return { context, page, errors };
}

for (const cpu of [1, 4, 8]) test(`idle multiplayer and controls under ${cpu}x CPU slowdown`, async ({ browser, baseURL }, info) => {
  const { context, page, errors } = await player(browser, baseURL, '저사양 확인', cpu > 1, cpu === 8);
  try {
    const client = await context.newCDPSession(page);
    await client.send('Emulation.setCPUThrottlingRate', { rate: cpu });
    await page.goto(`?meeting=cpu-${cpu}-${Date.now()}`); await ready(page); await play(page);
    await expect.poll(() => page.evaluate(() => (window as any).Pd4WebAudioContext?.state), { timeout: 30_000 }).toBe('running');
    await page.waitForTimeout(1500);
    const before = await state(page);
    await page.waitForTimeout(2000);
    const after = await state(page);
    console.log(JSON.stringify({ cpu, idlePositions: after.positions - before.positions, idleRenders: after.renders - before.renders, frames: after.frames - before.frames, shadows: after.shadows - before.shadows }));
    expect(after.positions - before.positions).toBeLessThanOrEqual(1);
    expect(after.renders - before.renders).toBeLessThanOrEqual(1);
    expect(after.shadows - before.shadows).toBeGreaterThan(0);
    expect(after.shadows - before.shadows).toBeLessThan(after.frames - before.frames);
    if (cpu === 8) {
      const canvas = page.locator('.play-shell canvas');
      await expect.poll(() => canvas.evaluate(el => (el as HTMLCanvasElement).width / el.clientWidth), { timeout: 20_000 }).toBe(.5);
      const adaptedBefore = await state(page); await page.waitForTimeout(2000); const adaptedAfter = await state(page);
      console.log(JSON.stringify({ cpu, adaptedPixelRatio: .5, frames: adaptedAfter.frames - adaptedBefore.frames }));
      await page.screenshot({ path: info.outputPath('low-spec-rain.png') });
    }
    await page.evaluate(() => {
      const get = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'bufferedAmount')!.get!;
      Object.defineProperty(WebSocket.prototype, 'bufferedAmount', { configurable: true, get() { return (window as any).__mp.busy ? 100000 : get.call(this); } });
      (window as any).__mp.busy = true;
    });
    const pending = (await state(page)).positions;
    await placePlayer(page, 19.4, 10, 0); await page.waitForTimeout(250);
    expect((await state(page)).positions).toBe(pending);
    await page.evaluate(() => { (window as any).__mp.busy = false; });
    await expect.poll(async () => { const current = await state(page); return current.presence.peers.find((p: any) => p.id === current.view.id)?.player.x; }).toBeCloseTo(19.4, 1);
    const pad = page.getByRole('group', { name: '이동 조이스틱', exact: true });
    const box = (await pad.boundingBox())!, start = await position(page);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 35);
    await page.mouse.down();
    await expect.poll(async () => (await position(page)).z, { timeout: 10_000 }).toBeLessThan(start.z - .1);
    await page.mouse.up();
    const stopped = await position(page);
    await page.waitForTimeout(500);
    expect((await position(page)).z).toBeCloseTo(stopped.z, 1);
    await page.getByRole('button', { name: '점프', exact: true }).click();
    await expect(page.locator('.play-shell canvas')).toHaveAttribute('data-motion', 'jump');
    await expect(page.locator('.play-shell canvas')).toHaveAttribute('data-motion', 'walk', { timeout: 10_000 });
    await page.getByRole('button', { name: '기어가기', exact: true }).click();
    await expect(page.getByRole('button', { name: '기어가기', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(errors).toEqual([]);
    expect((await state(page)).errors).toEqual([]);
    await info.attach('cpu-sample', { body: JSON.stringify({ cpu, before, after }), contentType: 'application/json' });
  } finally { await context.close(); }
});

test("walking keeps its speed when rendering falls to ten frames per second", async ({ browser, baseURL }) => {
  const { context, page, errors } = await player(browser, baseURL, '느린 화면');
  try {
    await page.goto(`?meeting=slow-frames-${Date.now()}`); await ready(page); await play(page);
    await placePlayer(page, 19, 10, 0);
    await page.evaluate(() => { (window as any).__mp.frameInterval = 100; });
    const walk = await page.evaluate(async () => {
      const before = (window as any).__testPlayer.z, start = performance.now();
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'w', bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 1600));
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', key: 'w', bubbles: true }));
      return { distance: before - (window as any).__testPlayer.z, seconds: (performance.now() - start) / 1000 };
    });
    console.log(JSON.stringify({ slowFramesWalk: walk }));
    expect(walk.distance / walk.seconds).toBeGreaterThan(1.2);
    expect(walk.distance / walk.seconds).toBeLessThan(1.8);
    expect((await position(page)).motion).toBe('walk');
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

for (const slow of [false, true]) test(`crossing, floor loss, whistle and safe disconnect return: ${slow ? '4x CPU and 150ms each way' : 'normal'}`, async ({ browser, baseURL }, info) => {
  const a = await player(browser, baseURL, '상대의 장면'), b = await player(browser, baseURL, '나의 장면', slow);
  let offline = false, cut: (() => void) | undefined;
  try {
    if (slow) {
      const client = await b.context.newCDPSession(b.page);
      await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      await b.page.routeWebSocket(/\/whistle\/meeting\?/, socket => {
        if (offline) { socket.close({ code: 1013 }); return; }
        const server = socket.connectToServer();
        let closed = false;
        const relay = (target: WebSocketRoute, message: string | Buffer) => setTimeout(() => { if (!closed) target.send(message); }, 150);
        socket.onMessage(message => relay(server, message)); server.onMessage(message => relay(socket, message));
        socket.onClose((code, reason) => { closed = true; server.close({ code, reason }); });
        server.onClose((code, reason) => { closed = true; socket.close({ code, reason }); });
        cut = () => { offline = true; closed = true; socket.close({ code: 1012 }); server.close(); };
      });
    }
    const url = `?meeting=cross-${slow}-${Date.now()}`;
    await a.page.goto(url); await ready(a.page); await b.page.goto(url); await ready(b.page);
    await expect(b.page.locator('.presence-number')).toHaveText('2');
    await expect(b.page.getByRole('button', { name: '배치: 상대의 장면', exact: true })).toBeVisible({ timeout: 70_000 });
    await b.page.getByRole('button', { name: '배치: 상대의 장면', exact: true }).click();
    await b.page.locator('[data-cell="126"]').click({ position: { x: 2, y: 2 } });
    await expect(b.page.locator('[data-connection-online="true"]')).toHaveCount(1);
    const gate = (await state(b.page)).view.connections[0]; expect(gate.x).toBe(12);
    await play(b.page);
    await placePlayer(b.page, 13.2, gate.z, -Math.PI / 2);
    await forwardTo(b.page, 11.25, 'left');
    await expect(b.page.locator('main')).toHaveAttribute('data-meeting-joined', '2');
    await expect(a.page.locator('.workspace .turn-status')).toHaveCount(0);
    await expect(b.page.locator('.turn-status')).toHaveCount(0);
    await play(a.page);
    await expect(a.page.getByRole('button', { name: '휘슬', exact: true })).toBeEnabled();
    await a.page.getByRole('button', { name: '휘슬', exact: true }).click();
    await expect.poll(async () => (await state(b.page)).whistles.length).toBe(1);
    await b.page.bringToFront();
    await b.page.getByRole('button', { name: '휘슬', exact: true }).click();
    await expect.poll(async () => (await state(a.page)).whistles.length).toBe(2);
    await a.page.bringToFront(); await a.page.keyboard.press('Escape');
    await a.page.getByRole('button', { name: '타일 지우기', exact: true }).click();
    await a.page.locator(`[data-cell="${gate.z * 12 + 11}"]`).click({ position: { x: 2, y: 2 } });
    await expect.poll(async () => (await state(b.page)).view.reset.reason).toBe('floor');
    await b.page.bringToFront();
    await expect.poll(async () => (await position(b.page)).x).toBeCloseTo(12, 1);
    await expect(b.page.locator('.play-shell canvas')).toHaveAttribute('data-motion', 'walk');
    await a.page.bringToFront(); await a.page.getByRole('button', { name: '바닥', exact: true }).click();
    await a.page.locator(`[data-cell="${gate.z * 12 + 11}"]`).click({ position: { x: 2, y: 2 } });
    await expect.poll(async () => (await state(b.page)).view.world.terrain.tiles[gate.z * 38 + 11].void).not.toBe(true);
    await placePlayer(b.page, 13.2, gate.z, -Math.PI / 2); await forwardTo(b.page, 11.25, 'left');
    if (slow) cut!(); else await a.page.close();
    await b.page.bringToFront();
    await expect.poll(async () => (await position(b.page)).x, { timeout: 15_000 }).toBeCloseTo(12, 1);
    await expect(b.page.locator('.play-shell canvas')).toHaveAttribute('data-motion', 'walk');
    await expect(b.page.getByRole('button', { name: '휘슬', exact: true })).toBeDisabled();
    await expect(b.page.locator('[data-connection]')).toHaveCount(1);
    await expect(b.page.locator('[data-connection]')).toHaveCSS('background-color', 'rgb(17, 17, 17)');
    await b.page.screenshot({ path: info.outputPath('safe-return.png') });
    await forwardTo(b.page, 13.1, 'right');
    await expect(b.page.locator('[data-connection]')).toHaveCount(0);
    await expect.poll(async () => (await savedWorld(b.page)).connectionFootings ?? []).toEqual([]);
    if (slow) {
      offline = false;
      await expect(b.page.locator('main')).toHaveAttribute('data-meeting-status', 'online', { timeout: 30_000 });
      await expect(b.page.locator('[data-connection-online="false"], [data-approach-online="false"]')).toHaveCount(0);
      await expect(b.page.locator('.play-shell canvas')).toHaveAttribute('data-ready', 'true');
      await expect.poll(async () => (await position(b.page)).x).toBeGreaterThan(12.6);
    }
    await b.page.keyboard.press('Escape');
    const own = await savedWorld(b.page);
    await b.page.getByRole('button', { name: '멀티플레이', exact: true }).click();
    await expect(b.page.locator('[data-connection], [data-approach]')).toHaveCount(0);
    expect((await savedWorld(b.page)).title).toBe(own.title);
    expect([...a.errors, ...b.errors]).toEqual([]);
    expect((await state(b.page)).errors).toEqual([]);
  } finally { await a.context.close(); await b.context.close(); }
});
