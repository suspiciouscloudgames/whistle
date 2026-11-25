import { test, expect, type Browser, type Page, type TestInfo, type WebSocketRoute } from "@playwright/test";
import { writeFile } from "node:fs/promises";
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
    const body = source.replace("pixelRenderer.render(scene, camera);", "pixelRenderer.render(scene, camera); globalThis.__mp.frames++;")
      .replace("const keys = new Set();", `const keys = new Set();
      if (mode === 'play') {
        globalThis.__peerTrailLine = scene.getObjectByName('peer-movement-trail');
        globalThis.__playCamera = camera;
        globalThis.__drawPlayFrame = () => { pixelRenderer.render(scene, camera); return renderer.domElement; };
      }
      globalThis.__testPlayer = player;
      globalThis.__placePlayer = p => { Object.assign(player, p, { falling: false, grounded: true });
        targetYaw = p.yaw; jump = air = falling = null; respawnFade = 0; lastGround = 0; report = 0; };`)
      .replace("const elapsed = time - last;", "if (time - last < (globalThis.__mp.frameInterval ?? 0)) { frame = requestAnimationFrame(render); return; } const elapsed = time - last;")
      .replace("renderer.shadowMap.needsUpdate = true;", "renderer.shadowMap.needsUpdate = true; globalThis.__mp.shadows++;");
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
  await page.waitForFunction(target => {
    const canvas = document.querySelector<HTMLCanvasElement>('.play-shell canvas');
    return canvas && Math.abs(Number(canvas.dataset.playerX) - target) < .05;
  }, x, { timeout: 20_000 });
}
async function forwardTo(page: Page, x: number, direction: 'left' | 'right') {
  await page.bringToFront();
  const progress = expect.poll(async () => {
    await page.keyboard.press('w', { delay: 160 });
    return page.evaluate(() => Number(document.querySelector<HTMLCanvasElement>('.play-shell canvas')?.dataset.playerX));
  }, { timeout: 45_000, intervals: [30] });
  if (direction === 'left') await progress.toBeLessThan(x);
  else await progress.toBeGreaterThan(x);
}

function trailState(page: Page) {
  return page.evaluate(() => {
    const line = (window as any).__peerTrailLine;
    const count = line.geometry.drawRange.count, vertices = line.geometry.attributes.position;
    let tiles = 0;
    for (let i = 1; i < count; i++)
      tiles += Math.hypot(vertices.getX(i) - vertices.getX(i-1), vertices.getZ(i) - vertices.getZ(i-1)) / 2;
    return { visible: line.visible, geometry: line.geometry.uuid, material: line.material.uuid, tiles };
  });
}

async function checkConnectedTrails(a: Page, b: Page, gateZ: number, info: TestInfo) {
  await placePlayer(b, 5, 8, 0);
  await placePlayer(a, 16.5, 5, Math.PI/2);
  const host = await a.locator('main').getAttribute('data-meeting-id');
  await expect.poll(async () => (await state(b)).presence.peers.find((p:any) => p.id === host)?.player?.x).toBeCloseTo(3.5, 1);
  const original = await trailState(b), idle = await state(b);
  await a.keyboard.down('w');
  try {
    const capture = await b.waitForFunction(() => {
      const line = (window as any).__peerTrailLine, draw = (window as any).__drawPlayFrame;
      const positions = line.geometry.attributes.position;
      let tiles = 0;
      for (let i = 1; i < line.geometry.drawRange.count; i++)
        tiles += Math.hypot(positions.getX(i) - positions.getX(i-1), positions.getZ(i) - positions.getZ(i-1)) / 2;
      if (!line.visible || tiles <= 1.4) return null;
      const source = draw() as HTMLCanvasElement, copy = document.createElement('canvas');
      copy.width = source.width; copy.height = source.height;
      const ctx = copy.getContext('2d', {willReadFrequently:true})!;
      ctx.drawImage(source, 0, 0);
      const on = ctx.getImageData(0, 0, copy.width, copy.height).data, png = copy.toDataURL();
      line.visible = false;
      ctx.drawImage(draw(), 0, 0);
      line.visible = true;
      draw();
      const off = ctx.getImageData(0, 0, copy.width, copy.height).data;
      const projected: { x: number; y: number }[] = [];
      const vertex = line.position.clone(), camera = (window as any).__playCamera;
      for (let j = 0; j < line.geometry.drawRange.count; j++) {
        vertex.fromBufferAttribute(line.geometry.attributes.position, j).applyMatrix4(line.matrixWorld).project(camera);
        projected.push({ x: (1 + vertex.x) * copy.width / 2, y: (1 - vertex.y) * copy.height / 2 });
      }
      let lemonPixels = 0, strongest = 0, maxOffset = 0;
      for (let i = 0; i < on.length; i += 4) {
        const tint = Math.min(on[i], on[i+1]) - on[i+2];
        if (tint <= 8 || tint <= Math.min(off[i], off[i+1]) - off[i+2] + 6) continue;
        lemonPixels++; strongest = Math.max(strongest, tint);
        const x = i / 4 % copy.width + .5, y = Math.floor(i / (4 * copy.width)) + .5;
        let nearest = Infinity;
        for (let j = 1; j < projected.length; j++) {
          const start = projected[j-1], end = projected[j];
          const dx = end.x - start.x, dy = end.y - start.y;
          const t = Math.max(0, Math.min(1, ((x - start.x) * dx + (y - start.y) * dy) / (dx*dx + dy*dy || 1)));
          nearest = Math.min(nearest, Math.hypot(x - start.x - t*dx, y - start.y - t*dy));
        }
        maxOffset = Math.max(maxOffset, nearest);
      }
      return { lemonPixels, strongest, maxOffset, png, tiles, geometry: line.geometry.uuid, material: line.material.uuid };
    }, undefined, { timeout: 20_000 });
    const frame = (await capture.jsonValue())!;
    await capture.dispose();
    await writeFile(info.outputPath('connected-peer-trail.png'), Buffer.from(frame.png.split(',')[1], 'base64'));
    expect(frame.lemonPixels).toBeGreaterThan(5);
    expect(frame.strongest).toBeGreaterThan(35);
    expect(frame.maxOffset).toBeLessThanOrEqual(1);
    expect(frame.tiles).toBeLessThanOrEqual(1.801);
    expect(frame.geometry).toBe(original.geometry);
    expect(frame.material).toBe(original.material);
    await b.screenshot({ path: info.outputPath('connected-play.png') });
  } finally { await a.keyboard.up('w'); }
  await expect.poll(async () => (await trailState(b)).visible, {timeout:3500}).toBe(false);
  const stopped = await state(b);
  expect(stopped.positions - idle.positions).toBeLessThanOrEqual(1);
  expect(stopped.renders - idle.renders).toBeLessThanOrEqual(1);

  await b.bringToFront(); await b.keyboard.down('w');
  try { await expect.poll(async () => (await trailState(a)).visible).toBe(true); }
  finally { await b.keyboard.up('w'); }
  await placePlayer(b, 11.2, gateZ, -Math.PI/2);
  await expect.poll(async () => (await trailState(a)).visible).toBe(false);
}
async function player(browser: Browser, baseURL: string | undefined, label: string, mobile = false, terrain: 'flat' | 'mixed' | 'rain' = 'flat') {
  const context = await browser.newContext({ baseURL, locale: 'ko-KR', viewport: mobile ? { width: 390, height: 844 } : { width: 640, height: 700 },
    isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
  const page = await context.newPage(), errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && /WebGL|THREE\./i.test(message.text())) errors.push(message.text());
  });
  const world = createMeetingWorld(29);
  world.timeOfDay = 'noon';
  world.terrain!.tiles = world.terrain!.tiles.map(() => ({ height: 0, surface: 'plain' }));
  if (terrain !== 'flat') world.terrain = terrainFixtures().mixed.terrain;
  if (terrain === 'rain') world.weather = "rain";
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
  const { context, page, errors } = await player(browser, baseURL, '저사양 확인', cpu > 1, cpu === 8 ? 'rain' : 'flat');
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
    const start = await page.evaluate(() => {
      const counters = (window as any).__mp;
      counters.frameInterval = 160;
      return { frames: counters.frames, shadows: counters.shadows };
    });
    const sample = await page.waitForFunction(start => {
      const counters = (window as any).__mp;
      const frames = counters.frames - start.frames;
      return frames >= 10 ? { frames, shadows: counters.shadows - start.shadows } : null;
    }, start, { timeout: 15_000 });
    const slowFrames = (await sample.jsonValue())!;
    expect(slowFrames.shadows).toBeGreaterThan(0);
    expect(slowFrames.shadows).toBeLessThanOrEqual(Math.ceil(slowFrames.frames / 2));
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

for (const slow of [false, true]) test(`crossing, floor loss, whistle and safe disconnect return: ${slow ? '4x CPU and 150ms each way' : 'normal'}`, async ({ browser, baseURL }, info) => {
  test.setTimeout(240_000);
  const a = await player(browser, baseURL, '상대의 장면', false, 'mixed'), b = await player(browser, baseURL, '나의 장면', slow);
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
    expect((await trailState(b.page)).visible).toBe(false);
    await placePlayer(b.page, 13.2, gate.z, -Math.PI / 2);
    await forwardTo(b.page, 11.25, 'left');
    await expect(b.page.locator('main')).toHaveAttribute('data-meeting-joined', '2');
    await expect(a.page.locator('.workspace .turn-status')).toHaveCount(0);
    await expect(b.page.locator('.turn-status')).toHaveCount(0);
    await play(a.page);
    await expect(a.page.getByRole('button', { name: '휘슬', exact: true })).toBeEnabled();
    await checkConnectedTrails(a.page, b.page, gate.z, info);
    await a.page.getByRole('button', { name: '휘슬', exact: true }).click();
    await expect.poll(async () => (await state(b.page)).whistles.length).toBe(1);
    await b.page.bringToFront();
    await b.page.getByRole('button', { name: '휘슬', exact: true }).click();
    await expect.poll(async () => (await state(a.page)).whistles.length).toBe(2);
    await a.page.bringToFront(); await a.page.keyboard.press('Escape');
    await a.page.getByRole('button', { name: '타일 지우기', exact: true }).click();
    await a.page.locator(`[data-cell="${gate.z * 12 + 11}"]`).click({ position: { x: 2, y: 2 } });
    await b.page.waitForFunction(() => (window as any).__mp.view.reset.reason === 'floor', undefined, { timeout: 30_000 });
    await b.page.bringToFront();
    await expect.poll(async () => (await position(b.page)).x, { timeout: 25_000 }).toBeCloseTo(12, 1);
    await expect(b.page.locator('.play-shell canvas')).toHaveAttribute('data-motion', 'walk');
    await a.page.bringToFront(); await a.page.getByRole('button', { name: '바닥', exact: true }).click();
    await a.page.locator(`[data-cell="${gate.z * 12 + 11}"]`).click({ position: { x: 2, y: 2 } });
    await b.page.waitForFunction(cell => !(window as any).__mp.view.world.terrain.tiles[cell].void, gate.z * 38 + 11, { timeout: 30_000 });
    await placePlayer(b.page, 13.2, gate.z, -Math.PI / 2); await forwardTo(b.page, 11.25, 'left');
    await play(a.page);
    await placePlayer(a.page, 17.5, 5, Math.PI / 2);
    await a.page.keyboard.down('w');
    try {
      await expect.poll(async () => (await trailState(b.page)).visible).toBe(true);
      if (slow) cut!(); else await a.page.close();
    } finally {
      if (!a.page.isClosed()) await a.page.keyboard.up('w');
    }
    await b.page.bringToFront();
    await expect.poll(async () => (await position(b.page)).x, { timeout: 25_000 }).toBeCloseTo(12, 1);
    await expect(b.page.locator('.play-shell canvas')).toHaveAttribute('data-motion', 'walk');
    await expect(b.page.getByRole('button', { name: '휘슬', exact: true })).toBeDisabled();
    expect((await trailState(b.page)).visible).toBe(false);
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
      expect((await trailState(b.page)).visible).toBe(false);
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
