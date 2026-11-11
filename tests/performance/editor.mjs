import { chromium } from "@playwright/test";
import ts from "typescript";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";

const label = process.argv[2] ?? "current";
const port = 5190;
const url = `http://127.0.0.1:${port}/whistle/`;
const server = spawn("npm", ["run", "dev", "--", "--port", String(port), "--strictPort"], {
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
server.stdout.on("data", (s) => { output += s; });
server.stderr.on("data", (s) => { output += s; });
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
    await page.route(/\/(lib\/(environment|terrain)\.ts|components\/whistle\/(TerrainScene\.ts|Scene\.tsx))(\?|$)/, async (route) => {
      const response = await route.fetch();
      let source = await response.text();
      if (route.request().url().includes("/Scene.tsx")) source = source.replace("renderer.render(scene, camera);", "");
      const tree = ts.createSourceFile("module.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
      const edits = [];
      for (const node of tree.statements) {
        if (!ts.isFunctionDeclaration(node) || !node.body || !node.name) continue;
        const name = node.name.text;
        if (!["makeTerrain", "deriveEnvironment", "deriveStructures"].includes(name)) continue;
        edits.push([node.body.getStart(tree) + 1, "const __measureStart = performance.now(); try {"]);
        edits.push([node.body.end - 1, `} finally { (globalThis.__terrainMeasures ??= []).push({name:${JSON.stringify(name)},ms:performance.now()-__measureStart}); }`]);
      }
      for (const [at, text] of edits.sort((a, b) => b[0] - a[0])) source = source.slice(0, at) + text + source.slice(at);
      await route.fulfill({ response, body: source });
    });
    await page.addInitScript(() => { localStorage.setItem("whistle.language", "ko"); });
    await page.goto(url);
    const fixture = await page.evaluate(async () => {
      const { starterWorld } = await import("/whistle/lib/world.ts");
      const { flatTerrain } = await import("/whistle/lib/terrain.ts");
      const w = starterWorld();
      w.objects = [];
      w.terrain = flatTerrain(12);
      w.terrain.seed = 4831;
      w.terrain.tiles.forEach((t) => { t.hole = false; });
      for (let z = 1; z <= 4; z++) for (let x = 1; x <= 4; x++) w.terrain.tiles[z * 12 + x].surface = "soft";
      for (let z = 2; z <= 3; z++) for (let x = 7; x <= 9; x++) w.terrain.tiles[z * 12 + x].surface = "slick";
      for (let x = 1; x <= 4; x++) w.terrain.tiles[6 * 12 + x].surface = "rough";
      localStorage.setItem("whistle.world.v2", JSON.stringify(w));
      return w;
    });
    await page.reload();
    await page.locator(".live-preview canvas").waitFor();
    const settle = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await settle();
    const take = async (phase) => {
      const samples = await page.evaluate(() => { const samples = globalThis.__terrainMeasures ?? []; globalThis.__terrainMeasures = []; return samples; });
      const result = { phase, metrics: Object.fromEntries(["makeTerrain", "deriveEnvironment", "deriveStructures"].map((name) => {
        const calls = samples.filter((s) => s.name === name);
        return [name, { calls: calls.length, ms: +calls.reduce((n, s) => n + s.ms, 0).toFixed(2) }];
      })) };
      console.log(trial, JSON.stringify(result));
      return result;
    };
    const phases = [await take("initial")];
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
    await page.getByRole("button", { name: "기호", exact: true }).click();
    await settle();
    for (const i of [96, 98, 100, 102, 104, 106]) {
      await page.locator(`[data-cell="${i}"]`).click();
      await settle();
    }
    phases.push(await take("six symbols without structures"));
    await page.getByRole("button", { name: "타일", exact: true }).click();
    await page.getByRole("button", { name: "높이기", exact: true }).click();
    for (const i of [120, 121, 122, 123, 124, 125]) {
      await page.locator(`[data-cell="${i}"]`).click();
      await settle();
    }
    phases.push(await take("six height edits"));
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("whistle.world.v2")));
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
