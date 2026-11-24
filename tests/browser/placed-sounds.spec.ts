import { savedWorld } from "./world-storage";
import { test, expect, type Page } from "@playwright/test";
import { terrainFixtures } from "../terrain-fixtures";
import { probePd, pdProbe } from "./pd-probe";
import { withEmptyContent } from "./content-fixture";

test.setTimeout(90_000);

function wav(seconds = 0.5) {
  const rate = 44100, count = Math.floor(rate * seconds), bytes = Buffer.alloc(44 + count * 2);
  bytes.write("RIFF"); bytes.writeUInt32LE(36 + count * 2, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36); bytes.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) bytes.writeInt16LE(Math.round(Math.sin(i / rate * Math.PI * 880) * 8000), 44 + i * 2);
  return bytes;
}
type Probe = { contexts: AudioContext[]; started: number; active: number; pd: number; rms: number };
const probe = (page: Page) => page.evaluate(() => {
  const p = (window as typeof window & { soundProbe: Probe }).soundProbe;
  return { contexts: p.contexts.map(c => c.state), started: p.started, active: p.active, pd: p.pd, rms: p.rms };
});
test.beforeEach(async ({ page }) => {
  await page.addInitScript(world => {
    if (!localStorage.getItem("whistle.world.v2")) localStorage.setItem("whistle.world.v2", JSON.stringify(world));
    localStorage.setItem("whistle.language", "ko");
    const state = window as typeof window & { soundProbe: Probe };
    state.soundProbe = { contexts: [], started: 0, active: 0, pd: 0, rms: 0 };
    const Original = window.AudioContext;
    window.AudioContext = class extends Original {
      constructor(options?: AudioContextOptions) { super(options); state.soundProbe.contexts.push(this); }
      createBufferSource() {
        const source = super.createBufferSource();
        const start = source.start.bind(source), stop = source.stop.bind(source);
        let active = false;
        const ended = () => { if (active) { active = false; state.soundProbe.active--; } };
        source.start = (...args) => { active = true; state.soundProbe.started++; state.soundProbe.active++; start(...args); };
        source.stop = (...args) => { ended(); stop(...args); };
        source.addEventListener("ended", ended);
        const analyser = this.createAnalyser(); analyser.fftSize = 512; source.connect(analyser);
        const wave = new Float32Array(512);
        const timer = setInterval(() => {
          if (this.state === "closed") { clearInterval(timer); return; }
          analyser.getFloatTimeDomainData(wave);
          state.soundProbe.rms = Math.sqrt(wave.reduce((s, n) => s + n * n, 0) / wave.length);
        }, 20);
        return source;
      }
    };
  }, withEmptyContent(terrainFixtures().flat, "sound"));
  await probePd(page);
  await page.goto(".");
  await expect(page.getByRole("button", { name: "파일 저장", exact: true })).toHaveAttribute("aria-description", "이 브라우저에 저장됨");
});

async function upload(page: Page, seconds = 0.5) {
  await page.getByRole("button", { name: "사운드 입력", exact: true }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "사운드 불러오기", exact: true }).click();
  await (await chooser).setFiles({ name: "목소리.wav", mimeType: "audio/wav", buffer: wav(seconds) });
  await expect(page.getByRole("button", { name: "저장", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "미리 듣기", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await page.locator('[data-symbol-kind="sound"][data-empty-symbol="false"]').click();
  await page.getByRole("button", {name: "배치 삭제", exact: true}).click();
  await page.getByRole("button", {name: "배치: 1", exact: true}).click();
}

test("upload, place, save, reload, mix with Pd, pause, resume and remove", async ({ page }) => {
  await upload(page);
  await page.locator('[data-cell="126"]').click();
  await expect(page.locator('[data-cell="126"] [data-symbol-site][data-symbol-kind=sound][data-empty-symbol=false]')).toBeVisible();
  await expect(page.locator(".sound-range").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "파일 저장", exact: true })).toHaveAttribute("aria-description", "이 브라우저에 저장됨");
  await page.reload();
  await expect(page.getByRole("button", { name: "배치: 1", exact: true })).toBeVisible();
  await expect(page.locator('[data-cell="126"] [data-symbol-site][data-symbol-kind=sound][data-empty-symbol=false]')).toBeVisible();
  await page.getByRole("button", { name: "플레이", exact: true }).click();
  await expect.poll(async () => (await probe(page)).active).toBe(1);
  await expect.poll(async () => (await probe(page)).rms).toBeGreaterThan(0.01);
  expect((await probe(page)).contexts).toEqual(["running"]);
  expect((await pdProbe(page)).modules).toBe(1);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect.poll(async () => (await probe(page)).active).toBe(0);
  await page.keyboard.press("a");
  await expect.poll(async () => (await probe(page)).active).toBe(1);
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await probe(page)).active).toBe(0);
  await page.getByRole("button", { name: "배치: 1", exact: true }).click();
  await page.getByRole("button", { name: "편집", exact: true }).click();
  await page.getByRole("button", { name: "사운드 삭제" }).click();
  await expect(page.getByRole("button", { name: "배치: 1", exact: true })).toHaveCount(0);
  await expect(page.locator('[data-cell="126"] [data-symbol-site][data-symbol-kind=sound][data-empty-symbol=false]')).toHaveCount(0);
  await page.getByRole("button", { name: "되돌리기", exact: true }).click();
  await expect(page.locator('[data-cell="126"] [data-symbol-site][data-symbol-kind=sound][data-empty-symbol=false]')).toBeVisible();
});

test("rejects large, invalid and long uploads without saving", async ({ page }) => {
  await page.getByRole("button", { name: "사운드 입력", exact: true }).click();
  const file = page.getByLabel("사운드 파일", { exact: true });
  await file.setInputFiles({ name: "large.wav", mimeType: "audio/wav", buffer: Buffer.alloc(10_000_001) });
  await expect(page.getByRole("alert")).toHaveText("파일 용량이 10MB를 초과했습니다.");
  await expect(page.getByRole("alert")).toHaveCount(0, { timeout: 7000 });
  await file.setInputFiles({ name: "invalid.wav", mimeType: "audio/wav", buffer: Buffer.from("invalid") });
  await expect(page.getByRole("alert")).toContainText("재생할 수 없습니다.");
  await file.setInputFiles({ name: "long.wav", mimeType: "audio/wav", buffer: wav(61) });
  await expect(page.getByRole("alert")).toContainText("1분을 초과");
  await expect(page.getByRole("button", { name: "저장", exact: true })).toBeDisabled();
});

test("sound placement limit and portable world file roundtrip", async ({ page }) => {
  await upload(page);
  const cells = await page.locator('[data-cell]').filter({hasNot:page.locator('[data-empty-symbol="true"]')}).evaluateAll(nodes=>nodes.slice(0,21).map(node=>node.getAttribute("data-cell")));
  for (const cell of cells) await page.locator(`[data-cell="${cell}"]`).click();
  await expect(page.locator("[data-symbol-site][data-symbol-kind=sound][data-empty-symbol=false]")).toHaveCount(20);
  await expect(page.locator(".toast")).toContainText("20개");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "파일 저장", exact: true }).click();
  const path = await (await download).path();
  await page.getByRole("button", { name: "편집", exact: true }).click();
  await page.getByRole("button", { name: "사운드 삭제" }).click();
  await expect(page.locator("[data-symbol-site][data-symbol-kind=sound][data-empty-symbol=false]")).toHaveCount(0);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "불러오기", exact: true }).click();
  await (await chooser).setFiles(path!);
  await expect(page.locator("[data-symbol-site][data-symbol-kind=sound][data-empty-symbol=false]")).toHaveCount(20);
  await expect(page.getByRole("button", { name: "배치: 1", exact: true })).toBeVisible();
});

test("sound editor fits mobile and updates the existing material", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await upload(page, 5);
  for (const cell of [125, 126]) await page.locator(`[data-cell="${cell}"]`).click();
  await page.getByRole("button", { name: "배치: 1", exact: true }).click();
  await page.locator('[data-cell="126"] [data-symbol-site][data-symbol-kind=sound][data-empty-symbol=false]').click();
  await expect(page.getByLabel("사운드 이름", { exact: true })).toHaveValue("1");
  await expect(page.getByLabel("사운드 이름", { exact: true })).toHaveAttribute("maxlength", "12");
  await page.getByLabel("사운드 이름", { exact: true }).fill("물소리");
  await expect(page.getByRole("dialog")).not.toContainText("10MB");
  await expect(page.getByLabel("들리는 범위", { exact: false })).toHaveCount(0);
  await page.getByRole("slider", { name: "볼륨", exact: true }).fill("0.4");
  await page.getByRole("button", { name: "미리 듣기", exact: true }).click();
  await expect(page.locator("audio")).toHaveJSProperty("paused", false);
  await expect(page.locator("audio")).toHaveJSProperty("volume", 0.4);
  await page.getByRole("button", { name: "미리 듣기 일시정지", exact: true }).click();
  await expect(page.locator("audio")).toHaveJSProperty("paused", true);
  await expect(page.getByRole("button", { name: "반복", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "한 번", exact: true }).click();
  await expect(page.getByRole("button", { name: "한 번", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "반복", exact: true })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const playbackSize = await page.getByRole("button", { name: "한 번", exact: true }).boundingBox();
  expect(playbackSize!.width).toBeLessThan(65);
  await page.screenshot({ path: "/tmp/whistle-sound-editor-mobile.png" });
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByRole("button", { name: "파일 저장", exact: true })).toHaveAttribute("aria-description", "이 브라우저에 저장됨");
  const sounds = (await savedWorld(page)).assets.filter(a=>a.sound).map(a=>[a.name,null,a.sound!.mode,a.sound!.volume]);
  expect(sounds).toEqual([["물소리", null, "approach", 0.4]]);
});

test("uploaded stereo WAV is compressed, keeps stereo and can be previewed", async ({ page }) => {
  const rate = 44100, count = rate * 2, bytes = Buffer.alloc(44 + count * 4);
  bytes.write("RIFF"); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(2, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 4, 28); bytes.writeUInt16LE(4, 32); bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36); bytes.writeUInt32LE(count * 4, 40);
  for (let i = 0; i < count; i++) {
    bytes.writeInt16LE(Math.round(Math.sin(i / rate * Math.PI * 880) * 8000), 44 + i * 4);
    bytes.writeInt16LE(Math.round(Math.sin(i / rate * Math.PI * 1320) * 4000), 46 + i * 4);
  }
  await page.getByRole("button", { name: "사운드 입력", exact: true }).click();
  await page.getByLabel("사운드 파일", { exact: true }).setInputFiles({ name: "stereo.wav", mimeType: "audio/wav", buffer: bytes });
  await expect(page.getByRole("button", { name: "저장", exact: true })).toBeEnabled();
  const result = await page.locator("audio").evaluate(async element => {
    const data = (element as HTMLAudioElement).src;
    const encoded = await (await fetch(data)).arrayBuffer();
    const buffer = await new OfflineAudioContext(2, 1, 44100).decodeAudioData(encoded.slice(0));
    const left = buffer.getChannelData(0), right = buffer.getChannelData(1);
    let difference = 0;
    for (let i = 0; i < left.length; i++) difference += Math.abs(left[i] - right[i]);
    return { dataPrefix: data.slice(0, 23), bytes: encoded.byteLength, channels: buffer.numberOfChannels, duration: buffer.duration, difference };
  });
  expect(result.dataPrefix).toBe("data:audio/mpeg;base64,");
  expect(result.bytes).toBeLessThan(bytes.length / 3);
  expect(result.channels).toBe(2);
  expect(result.duration).toBeGreaterThanOrEqual(2);
  expect(result.duration).toBeLessThan(2.1);
  expect(result.difference).toBeGreaterThan(1);
  await page.getByRole("button", { name: "미리 듣기", exact: true }).click();
  await expect(page.locator("audio")).toHaveJSProperty("paused", false);
});

test("a full minute is accepted and compressed below 1 MB", async ({ page }) => {
  await page.getByRole("button", { name: "사운드 입력", exact: true }).click();
  await page.getByLabel("사운드 파일", { exact: true }).setInputFiles({ name: "minute.wav", mimeType: "audio/wav", buffer: wav(60) });
  await expect(page.getByRole("button", { name: "저장", exact: true })).toBeEnabled({ timeout: 45000 });
  const result = await page.locator("audio").evaluate(async element => {
    const audio = element as HTMLAudioElement;
    return { duration: audio.duration, bytes: (await (await fetch(audio.src)).blob()).size, mp3: audio.src.startsWith("data:audio/mpeg;") };
  });
  expect(result.mp3).toBe(true);
  expect(result.bytes).toBeLessThan(1_000_000);
  expect(result.duration).toBeGreaterThanOrEqual(60);
  expect(result.duration).toBeLessThan(60.1);
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
