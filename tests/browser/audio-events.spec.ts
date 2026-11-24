import { test, expect } from "@playwright/test";

test("Daban rain and button whistles produce audio, stop, and pan without restarting the engine", async ({page}) => {
  test.setTimeout(60_000);
  await page.context().grantPermissions(["local-network-access"]);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error" || /couldn't create|connection failed|no such object/.test(message.text())) errors.push(message.text());
  });
  await page.route("**/audio-events-test", route => route.fulfill({
    contentType: "text/html", headers: {"Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp"},
    body: `<button>Start</button><script type="module">
      import { openEngine } from '/whistle/lib/audio/pd-runtime.ts';
      document.querySelector('button').onclick = async () => {
        const engine = await openEngine('/whistle/audio/');
        await engine.context.resume();
        const split = engine.context.createChannelSplitter(2);
        engine.mixdown.connect(split); engine.mixdown.connect(engine.context.destination);
        const analysers = [0, 1].map(channel => {
          const analyser = engine.context.createAnalyser(); analyser.fftSize = 2048;
          split.connect(analyser, channel); return analyser;
        });
        window.send = (bus, values) => engine.send(bus, values);
        window.levels = () => analysers.map(analyser => {
          const values = new Float32Array(2048); analyser.getFloatTimeDomainData(values);
          return Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
        });
      };
    </script>`,
  }));
  await page.goto("audio-events-test");
  await page.getByRole("button", {name: "Start"}).click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).send), {timeout: 30_000}).toBe("function");
  const send = (bus: string, values: (number | string)[]) => page.evaluate(({bus, values}) => (window as any).send(bus, values), {bus, values});
  const levels = (): Promise<number[]> => page.evaluate(() => (window as any).levels());
  const peak = async () => Math.max(...await levels());
  await expect.poll(peak).toBeLessThan(.000001);
  await send("whistle-event", ["rain", 1]);
  await expect.poll(peak, {timeout: 10_000}).toBeGreaterThan(.0001);
  await send("whistle-event", ["rain", 0]);
  await expect.poll(peak, {timeout: 10_000}).toBeLessThan(.000001);
  for (const pan of [-1, 1]) {
    await send("whistle-blow", [1, pan]);
    const active = pan === -1 ? 0 : 1;
    await expect.poll(async () => (await levels())[active], {intervals: [20, 40, 80], timeout: 1500}).toBeGreaterThan(.0001);
    await expect.poll(async () => (await levels())[1 - active], {intervals: [20, 40, 80], timeout: 500}).toBeLessThan(.000001);
    expect((await levels())[active]).toBeGreaterThan(.0001);
    await expect.poll(peak).toBeLessThan(.000001);
  }
  await send("whistle-blow", [1, 0]);
  await expect.poll(peak, {intervals: [20, 40, 80], timeout: 1500}).toBeGreaterThan(.0001);
  await send("whistle-player-stop", ["bang"]);
  await expect.poll(peak, {intervals: [20, 40, 80], timeout: 1000}).toBeLessThan(.000001);
  expect(errors).toEqual([]);
});
