import { chromium, expect } from "@playwright/test";
import ts from "typescript";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";

import { starterWorld } from "../../lib/world.ts";
import { flatTerrain } from "../../lib/terrain.ts";
import { savedWorld } from "../browser/world-storage.ts";

const label = process.argv[2] ?? "current";
const port = 5190;
const url = `http://127.0.0.1:${port}/whistle/`;
const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
server.stdout.on("data", (s) => { output += s; });
server.stderr.on("data", (s) => { output += s; });
const metrics = ["makeTerrain", "deriveEnvironment", "deriveStructures", "copyDocument"];
const fixture = starterWorld();
fixture.objects = [];
fixture.assets[0].text = "측정용 기호";
fixture.terrain = flatTerrain(fixture.size);
fixture.terrain.seed = 4831;
for (let z = 1; z <= 4; z++) for (let x = 1; x <= 4; x++) fixture.terrain.tiles[z * fixture.size + x].surface = "soft";
for (let z = 2; z <= 3; z++) for (let x = 7; x <= 9; x++) fixture.terrain.tiles[z * fixture.size + x].surface = "slick";
for (let x = 1; x <= 4; x++) fixture.terrain.tiles[6 * fixture.size + x].surface = "rough";
let browser;
try {
  for (let i = 0; ; i++) {
    if (server.exitCode !== null || i > 100) throw new Error(output);
    try { if ((await fetch(url)).ok) break; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.launch();
  const runs = [];
  for (let trial = 0; trial < 3; trial++) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: "ko-KR" });
    await page.route(/\/(lib\/(environment|terrain)\.ts|components\/whistle\/(TerrainScene\.ts|Scene\.tsx|useWorldDocument\.ts))(\?|$)/, async (route) => {
      const response = await route.fetch();
      let source = await response.text();
      if (route.request().url().includes("/Scene.tsx")) source = source
        .replace("pixelRenderer.render(scene, camera);", "")
        .replace("waterReflection.update(renderer, scene, camera, terrain.group, time);", "");
      const tree = ts.createSourceFile("module.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
      const edits = [];
      for (const node of tree.statements) {
        if (!ts.isFunctionDeclaration(node) || !node.body || !node.name) continue;
        const name = node.name.text;
        if (!metrics.includes(name)) continue;
        edits.push([node.body.getStart(tree) + 1, "const __measureStart = performance.now(); try {"]);
        edits.push([node.body.end - 1, `} finally { (globalThis.__terrainMeasures ??= []).push({name:${JSON.stringify(name)},ms:performance.now()-__measureStart}); }`]);
      }
      for (const [at, text] of edits.sort((a, b) => b[0] - a[0])) source = source.slice(0, at) + text + source.slice(at);
      await route.fulfill({ response, body: source });
    });
    await page.addInitScript(world => {
      localStorage.setItem("whistle.language", "ko");
      localStorage.setItem("whistle.world.v2", JSON.stringify(world));
    }, fixture);
    await page.goto(url + "?meeting=benchmark-" + Date.now());
    await expect(page.locator(".live-preview canvas")).toHaveAttribute("data-ready", "true");
    await expect.poll(async () => (await savedWorld(page))?.terrain?.seed).toBe(fixture.terrain.seed);
    const settle = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await settle();
    const take = async (phase) => {
      const samples = await page.evaluate(() => { const samples = globalThis.__terrainMeasures ?? []; globalThis.__terrainMeasures = []; return samples; });
      const result = { phase, metrics: Object.fromEntries(metrics.map((name) => {
        const calls = samples.filter((s) => s.name === name);
        return [name, { calls: calls.length, ms: +calls.reduce((n, s) => n + s.ms, 0).toFixed(2) }];
      })) };
      console.log(trial, JSON.stringify(result));
      return result;
    };
    const phases = [await take("initial")];
    expect(phases[0].metrics.makeTerrain.calls).toBeGreaterThan(0);
    await page.getByRole("button", { name: "바닥", exact: true }).click();
    const cell = page.locator('[data-cell="132"]');
    const bounds = await cell.boundingBox();
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    for (let i = 0; i < 8; i++) {
      await page.mouse.move(bounds.x + bounds.width / 2 + (i % 2 ? 8 : 10), bounds.y + bounds.height / 2);
      await settle();
    }
    await page.mouse.up();
    await settle();
    phases.push(await take("unchanged paint"));
    await page.getByRole("button", { name: "배치: 측정용 기호", exact: true }).click();
    await settle();
    for (const i of [96, 98, 100, 102, 104, 106]) {
      await page.locator(`[data-cell="${i}"]`).click();
      await settle();
    }
    phases.push(await take("six symbols without structures"));
    await page.getByRole("button", { name: "높이기", exact: true }).click();
    for (const i of [120, 121, 122, 123, 124, 125]) {
      await page.locator(`[data-cell="${i}"]`).click();
      await settle();
    }
    phases.push(await take("six height edits"));
    await expect.poll(async () => (await savedWorld(page))?.terrain.tiles[125].height).toBe(1);
    const saved = await savedWorld(page);
    expect(saved.objects.filter(object => object.asset === fixture.assets[0].id)).toHaveLength(6);
    runs.push({ trial, phases, seed: fixture.terrain.seed, size: saved.size });
    await page.close();
  }
  await mkdir("output/performance", { recursive: true });
  await writeFile(`output/performance/${label}.json`, JSON.stringify(runs, null, 2));
  console.log(JSON.stringify(runs, null, 2));
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
