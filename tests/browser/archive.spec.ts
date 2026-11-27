import { test, expect, type Page } from "@playwright/test";
import { createServer, type IncomingHttpHeaders } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { createMeetingWorld } from "../../lib/meeting";
import { ARCHIVE_PATH } from "../../lib/archive-protocol";
import { savedWorld } from "./world-storage";

const objects = new Map<string, { body: Buffer; metadata: IncomingHttpHeaders; date: Date }>();
let failWrites = false;
const storage = createServer(async (req, res) => {
  const url = new URL(req.url!, "http://localhost");
  if (!req.headers.authorization?.startsWith("AWS4-HMAC-SHA256 Credential=archive-test/") ||
      !url.pathname.startsWith("/test-bucket/")) { res.writeHead(403).end(); return; }
  if (url.searchParams.get("list-type") === "2") {
    const keys = [...objects.keys()].sort().filter(key => key.startsWith(url.searchParams.get("prefix") ?? ""));
    const start = Number(url.searchParams.get("continuation-token") ?? 0);
    const end = start + Number(url.searchParams.get("max-keys"));
    const contents = keys.slice(start, end).map(key => "<Contents><Key>" + key + "</Key><LastModified>" +
      objects.get(key)!.date.toISOString() + "</LastModified></Contents>");
    res.setHeader("Content-Type", "application/xml");
    res.end("<ListBucketResult>" + contents.join("") +
      (end < keys.length ? "<NextContinuationToken>" + end + "</NextContinuationToken>" : "") + "</ListBucketResult>");
    return;
  }
  const key = url.pathname.slice("/test-bucket/".length);
  if (req.method === "PUT") {
    if (failWrites) { res.writeHead(403).end(); return; }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const metadata = Object.fromEntries(Object.entries(req.headers).filter(([key]) => key.startsWith("x-amz-meta-")));
    objects.set(key, { body: Buffer.concat(chunks), metadata, date: new Date() });
    res.writeHead(200).end();
    return;
  }
  const item = objects.get(key);
  if (!item) { res.writeHead(404).end(); return; }
  res.writeHead(200, { ...item.metadata, "Content-Length": item.body.length, "Last-Modified": item.date.toUTCString() });
  res.end(req.method === "HEAD" ? undefined : item.body);
});

let app: ChildProcess, url: string;
test.beforeAll(async () => {
  storage.listen(0, "127.0.0.1");
  await once(storage, "listening");
  app = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "0"], {
    env: { ...process.env, R2_BUCKET: "test-bucket", R2_ACCESS_KEY_ID: "archive-test", R2_SECRET_ACCESS_KEY: "local-testing",
      R2_ENDPOINT: "http://127.0.0.1:" + (storage.address() as AddressInfo).port, NO_COLOR: "1" }, stdio: ["ignore", "pipe", "inherit"],
  });
  url = await new Promise<string>((resolve, reject) => {
    app.stdout!.on("data", chunk => {
      const address = /http:\/\/127\.0\.0\.1:\d+/.exec(String(chunk));
      if (address) resolve(address[0]);
    });
    app.once("exit", () => reject(new Error("Archive test server exited.")));
    app.once("error", reject);
  });
});
test.afterAll(async () => {
  if (app && app.exitCode === null && !app.signalCode) { const exited = once(app, "exit"); app.kill(); await exited; }
  storage.closeAllConnections();
  await new Promise<void>(resolve => storage.close(() => resolve()));
});

const save = (page: Page) => page.getByRole("button", { name: "파일 저장", exact: true });
async function enter(page: Page, room: string) {
  await page.goto(url + "/whistle/?meeting=" + room);
  await expect(save(page)).toHaveAttribute("aria-description", "이 브라우저에 저장됨");
}
async function download(page: Page) {
  const event = page.waitForEvent("download");
  await save(page).click();
  return readFile((await (await event).path())!);
}

test("downloads the published file, updates the owner's entry and lets another browser save a copy", async ({ page, browser }) => {
  objects.clear();
  const original = createMeetingWorld(123);
  original.title = "갈대의 세계";
  await page.addInitScript(world => localStorage.setItem("whistle.world.v2", JSON.stringify(world)), original);
  await enter(page, "archive-owner");
  await page.getByRole("button", { name: "아카이브", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("아직 공개된 세계가 없습니다.");
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  const file = await download(page);
  await expect(page.getByRole("status")).toContainText("로컬 파일과 아카이브에 저장했습니다.");
  const [key] = objects.keys();
  expect(objects.get(key)?.body.equals(file)).toBe(true);
  await page.reload();
  await page.getByRole("button", { name: "아카이브", exact: true }).click();
  await page.getByRole("button", { name: /갈대의 세계/ }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await download(page);
  await expect(page.getByRole("status")).toContainText("로컬 파일과 아카이브에 저장했습니다.");
  expect([...objects.keys()]).toEqual([key]);
  const ownerBytes = objects.get(key)!.body;

  const other = await browser.newContext({ viewport: { width: 320, height: 568 } });
  try {
    const guest = await other.newPage();
    await enter(guest, "archive-guest");
    for (const label of ["English", "한국어"]) {
      await guest.getByRole("button", { name: label, exact: true }).click();
      for (const [left, right] of [[".presence-number", ".display-tools"], [".view-tabs", ".file-actions"]]) {
        const before = (await guest.locator(left).boundingBox())!;
        const after = (await guest.locator(right).boundingBox())!;
        expect(before.x + before.width).toBeLessThanOrEqual(after.x + 1);
        expect(after.x + after.width).toBeLessThanOrEqual(321);
      }
    }
    await guest.getByRole("button", { name: "아카이브", exact: true }).click();
    await guest.getByRole("button", { name: /갈대의 세계/ }).click();
    await expect(guest.getByRole("dialog")).toHaveCount(0);
    await expect.poll(async () => (await savedWorld(guest)).title).toBe(original.title);
    expect((await savedWorld(guest)).workshop!.id).not.toBe(original.workshop!.id);
    await guest.getByRole("button", { name: "높이기", exact: true }).click();
    await guest.locator('[data-cell="0"]').click();
    const fork = await download(guest);
    await expect(guest.getByRole("status")).toContainText("로컬 파일과 아카이브에 저장했습니다.");
    expect(objects.size).toBe(2);
    expect(objects.get(key)!.body.equals(ownerBytes)).toBe(true);
    expect([...objects.values()].some(item => item.body.equals(fork))).toBe(true);
  } finally { await other.close(); }
});

test("retries the failed archive snapshot without downloading again", async ({ page, request }) => {
  objects.clear();
  await enter(page, "archive-retry");
  let downloads = 0;
  page.on("download", () => downloads++);
  failWrites = true;
  let file: Buffer;
  try {
    file = await download(page);
    await expect(page.getByRole("alert")).toContainText("로컬 파일만 저장했습니다.");
  } finally { failWrites = false; }
  expect(objects.size).toBe(0);
  await page.getByRole("button", { name: "높이기", exact: true }).click();
  await page.locator('[data-cell="0"]').click();
  await page.getByRole("button", { name: "아카이브 저장 재시도" }).click();
  await expect(page.getByRole("status")).toContainText("로컬 파일과 아카이브에 저장했습니다.");
  expect(downloads).toBe(1);
  expect([...objects.values()][0].body.equals(file)).toBe(true);
  const api = url + ARCHIVE_PATH;
  expect((await request.post(api, { data: {} })).status()).toBe(403);
  expect((await request.post(api, { data: {}, headers: { Authorization: "Bearer " + "a".repeat(64) } })).status()).toBe(400);
  expect((await request.get(api + "/" + "0".repeat(64))).status()).toBe(404);
});

test("the public archive paginates and protects originals even when a local file is reuploaded", async ({ request }) => {
  objects.clear();
  const world = createMeetingWorld(456);
  const api = url + ARCHIVE_PATH;
  const published = new Set<string>();
  const writer = (n: number) => ({ Authorization: "Bearer " + n.toString(16).padStart(64, "0") });
  for (let i = 1; i <= 21; i++) {
    const response = await request.post(api, { headers: writer(i), data: world });
    expect(response.ok()).toBe(true);
    published.add((await response.json()).id);
  }
  expect(published.size).toBe(21);
  const first = await (await request.get(api)).json();
  expect(first.items).toHaveLength(20);
  const last = await (await request.get(api, { params: { cursor: first.cursor } })).json();
  expect(last.cursor).toBeUndefined();
  expect(new Set([...first.items, ...last.items].map(item => item.id))).toEqual(published);
  const path = api + "/" + [...published][0];
  for (const n of [1, 2]) {
    const result = await request.get(path, { headers: writer(n) });
    expect(result.headers()["x-whistle-archive-owner"]).toBe(n === 1 ? "1" : "0");
    expect(await result.json()).toEqual(world);
  }
});
