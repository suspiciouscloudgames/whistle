import { test, expect } from "@playwright/test";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// 개발 서버에서 패치를 고치면 새로고침 없이 반영된다(vite.config.ts → lib/audio/pd-runtime.ts).
// 시험용 패치 두 개를 audio/patches/에 잠깐 만들었다가 지운다.
test.setTimeout(90_000);
const dir = join(import.meta.dirname, "../../audio/patches");
const outer = join(dir, "zz-live.pd");
const inner = join(dir, "zz-live-inner.pd");
// [r $1-amp] → [sig~] × [zz-live-inner] → 두 outlet~
const OUTER = `#N canvas 0 0 400 300 12;
#X obj 20 20 r \\$1-amp;
#X obj 20 50 sig~;
#X obj 120 50 zz-live-inner;
#X obj 20 80 *~;
#X obj 20 110 outlet~;
#X obj 120 110 outlet~;
#X connect 0 0 1 0;
#X connect 1 0 3 0;
#X connect 2 0 3 1;
#X connect 3 0 4 0;
#X connect 3 0 5 0;
`;
const INNER = (source: string) => `#N canvas 0 0 400 300 12;
#X obj 20 20 ${source};
#X obj 20 50 outlet~;
#X connect 0 0 1 0;
`;

test.afterEach(() => { rmSync(outer, { force: true }); rmSync(inner, { force: true }); });

test("패치를 고치면 떠 있는 슬롯을 다시 만들고(안쪽 abstraction 포함) 마지막 값을 다시 보낸다", async ({ page }) => {
  writeFileSync(outer, OUTER);
  writeFileSync(inner, INNER("sig~ 0"));
  const logs: string[] = [];
  page.on("console", (message) => logs.push(message.text()));
  await page.goto("audio-lab/soundscape.html");
  await page.getByRole("button", { name: "오디오 시작" }).click();
  await expect(page.locator("#status")).toContainText("running");

  const rms = () => page.evaluate(() => {
    const w = window as unknown as { liveAnalyser: AnalyserNode };
    const wave = new Float32Array(2048);
    w.liveAnalyser.getFloatTimeDomainData(wave);
    return Math.sqrt(wave.reduce((sum, n) => sum + n * n, 0) / wave.length);
  });
  await page.evaluate(async () => {
    const { openEngine } = await import(/* @vite-ignore */ `${location.origin}/whistle/lib/audio/pd-runtime.ts`);
    const engine = await openEngine("/whistle/audio/");
    const patch = await engine.start("zz-live");
    const analyser = new AnalyserNode(engine.context, { fftSize: 2048 });
    patch.node.connect(analyser);
    patch.node.connect(engine.context.destination); // 출력이 이어져야 엔진이 돈다
    patch.send("amp", [0.5]);
    (window as unknown as { liveAnalyser: AnalyserNode }).liveAnalyser = analyser;
  });
  await page.waitForTimeout(500);
  expect(await rms()).toBeLessThan(0.001); // 안쪽이 무음

  writeFileSync(inner, INNER("osc~ 440"));
  await expect.poll(() => logs.some((l) => /패치 갱신: zz-live-inner\.pd \(다시 만듦: v\d+ zz-live/.test(l)), { timeout: 10_000 }).toBe(true);
  // 다시 만든 뒤 amp 0.5를 다시 보냈으면 0.5 × 사인(RMS 0.707) ≈ 0.35
  await expect.poll(rms, { timeout: 5_000 }).toBeGreaterThan(0.3);
});
