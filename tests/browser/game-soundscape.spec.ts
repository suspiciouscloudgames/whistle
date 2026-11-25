// 게임 화면에서 3D 플레이 중 지형 사운드스케이프를 확인한다.
// 3D 장면을 GPU로 렌더링해야 한다. GPU 없는(소프트웨어 렌더링) 브라우저에서는 장면이 너무 느려
// 클릭 단계에서 멈추므로 기본으로는 건너뛴다. 실행: WHISTLE_GPU_TESTS=1 npx playwright test tests/browser/game-soundscape.spec.ts
import { test, expect, type Page } from "@playwright/test";

test.skip(!process.env.WHISTLE_GPU_TESTS, "GPU 렌더링이 필요하다(WHISTLE_GPU_TESTS=1)");
// headless shell 대신 일반 Chromium의 새 headless 모드로 GPU를 쓴다.
test.use({ channel: "chromium", launchOptions: { args: ["--enable-gpu", "--use-angle=gl", "--ignore-gpu-blocklist"] } });
test.setTimeout(180_000);

type Probe = { peak: number };

/** 테스트에서만: 최종 출력(destination으로 가는 연결)에 분석기를 단다. */
async function instrument(page: Page) {
  const logs: string[] = [];
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.text().startsWith("[Whistle:Audio]")) logs.push(message.text());
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("whistle.language", "ko");
    const state = window as typeof window & { probe: Probe };
    state.probe = { peak: 0 };
    const connect = AudioNode.prototype.connect as (this: AudioNode, ...args: unknown[]) => unknown;
    AudioNode.prototype.connect = function (this: AudioNode, ...args: unknown[]) {
      if (args[0] instanceof AudioDestinationNode) {
        const analyser = this.context.createAnalyser();
        connect.call(this, analyser);
        const data = new Float32Array(analyser.fftSize);
        const read = () => {
          if (this.context.state === "closed") return;
          analyser.getFloatTimeDomainData(data);
          for (const v of data) state.probe.peak = Math.max(state.probe.peak, Math.abs(v));
          requestAnimationFrame(read);
        };
        read();
      }
      return connect.apply(this, args);
    } as typeof AudioNode.prototype.connect;
  });
  return { logs, errors };
}
const probe = (page: Page) => page.evaluate(() => (window as unknown as { probe: Probe }).probe);
const count = (logs: string[], pattern: RegExp) => logs.filter((l) => pattern.test(l)).length;

test.afterEach(async ({}, info) => {
  const logs = (info as unknown as { _logs?: string[] })._logs;
  if (logs && info.status !== info.expectedStatus) await info.attach("audio-logs", { body: logs.join("\n"), contentType: "text/plain" });
});

test("3D 플레이: 소리 영역을 등록하고 플레이어 근처 영역만(가까운 순 최대 6개) 켜서 소리를 내며, 에디터로 돌아가면 끈다", async ({ page }, info) => {
  const { logs, errors } = await instrument(page);
  (info as unknown as { _logs?: string[] })._logs = logs;
  await page.goto(".");
  const renderer = await page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2");
    const debug = gl?.getExtension("WEBGL_debug_renderer_info");
    return debug ? gl!.getParameter(debug.UNMASKED_RENDERER_WEBGL) : "unknown";
  });
  info.annotations.push({ type: "webgl", description: String(renderer) });
  await expect(page.getByRole("button", { name: "파일 저장", exact: true }))
    .toHaveAttribute("aria-description", "이 브라우저에 저장됨", { timeout: 60_000 });
  await page.getByRole("button", { name: "거침", exact: true }).click();
  await page.locator('[data-cell="126"]').click({ position: { x: 2, y: 2 } });
  await expect(page.locator('[data-cell="126"]')).toHaveAccessibleName(/거침/);

  await page.getByRole("button", { name: "플레이", exact: true }).click();
  await expect.poll(() => count(logs, /오디오 시작/), { timeout: 60_000 }).toBe(1);
  await expect.poll(() => count(logs, /소리 영역 등록/), { timeout: 30_000 }).toBe(1);
  await expect.poll(() => count(logs, /켜짐/), { timeout: 60_000 }).toBeGreaterThan(0);

  // 이동에 따른 켜고 끄기는 단위 테스트(tests/game-soundscape.test.ts, tests/terrain-sources.test.ts)가 본다.
  // (headless에서 keyboard.down("w")가 이동으로 이어지지 않아 여기서는 걷지 않는다: 위치가 그대로였음)
  await page.waitForTimeout(2000);
  const lit = count(logs, /켜짐/) - count(logs, /꺼짐/);
  const registered = Number(/소리 영역 등록 (\d+)개/.exec(logs.find((l) => /소리 영역 등록/.test(l))!)![1]);
  expect(lit).toBeGreaterThan(0);
  expect(lit).toBeLessThanOrEqual(Math.min(6, registered));
  await expect.poll(async () => (await probe(page)).peak, { timeout: 20_000 }).toBeGreaterThan(0.001);

  // 에디터로 돌아가면 켜진 영역이 모두 꺼진다.
  await page.keyboard.press("Escape");
  await expect.poll(() => count(logs, /켜짐/) - count(logs, /꺼짐/), { timeout: 30_000 }).toBe(0);
  info.annotations.push({ type: "audio-start", description: logs.find((l) => /오디오 시작/.test(l)) ?? "" });
  expect(errors).toEqual([]);
});
