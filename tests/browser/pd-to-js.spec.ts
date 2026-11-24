import { test, expect } from "@playwright/test";

// Pd → JS 받기(audio/pd-to-js.md): 같은 이름을 여럿이 받는다(Pd의 [r]처럼), 종류마다 맞는 모양으로 온다.
test.setTimeout(60_000);

test("Pd → JS: 같은 이름을 여럿이 한 번씩 받고, 그만 받기와 종류 검사가 된다", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto("audio-lab/soundscape.html");
  await page.getByRole("button", { name: "오디오 시작" }).click();
  await expect(page.locator("#status")).toContainText("running");
  // 엔진은 출력이 연결된 슬롯이 하나라도 있어야 돈다.
  await page.locator("#patch").selectOption("terrain_clock");
  await page.locator("#map").click({ position: { x: 80, y: 160 } });
  await expect(page.locator("#sources")).toContainText("active");

  const result = await page.evaluate(async () => {
    type Pd = Record<string, (...args: unknown[]) => unknown>;
    const pd = (window as unknown as { Pd4Web: Pd }).Pd4Web;
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const got: string[] = [];
    const take = async (send: () => void, expected=1) => {
      got.length=0;send();
      const until=performance.now()+3000;
      while(got.length<expected&&performance.now()<until)await wait(20);
      await wait(50);
      return [...got];
    };

    // [r to-js] → [s 이름] 대신 JS에서 바로 그 이름으로 보낸다: 받는 쪽은 같다(이름에 묶인 받는 객체).
    const stopA = pd.onFloatReceived("probe-f", (name: unknown, value: unknown) => got.push(`A ${name} ${value}`)) as () => void;
    pd.onFloatReceived("probe-f", (...args: unknown[]) => got.push(`B ${args.join(" ")}`)); // 나머지 인자도 된다
    const both = await take(() => pd.sendFloat("probe-f", 0.5),2);
    stopA();
    const afterStop = await take(() => pd.sendFloat("probe-f", 1));

    let mixed = "";
    try { pd.onListReceived("probe-f", () => {}); } catch (error) { mixed = String(error); }

    pd.onBangReceived("probe-b", (...a: unknown[]) => got.push(JSON.stringify(a)));
    pd.onSymbolReceived("probe-s", (...a: unknown[]) => got.push(JSON.stringify(a)));
    pd.onListReceived("probe-l", (...a: unknown[]) => got.push(JSON.stringify(a)));
    pd.onMessageReceived("probe-m", (...a: unknown[]) => got.push(JSON.stringify(a)));
    return {
      both, afterStop, mixed,
      bang: await take(() => pd.sendBang("probe-b")),
      symbol: await take(() => pd.sendSymbol("probe-s", "grass")),
      list: await take(() => pd.sendList("probe-l", [1, 2, "x"])),
      message: await take(() => pd.sendMessage("probe-m", "step", ["grass", 0.5])),
    };
  });

  expect(result.both.sort()).toEqual(["A probe-f 0.5", "B probe-f 0.5"]);
  expect(result.afterStop).toEqual(["B probe-f 1"]);
  expect(result.mixed).toContain("한 이름에 종류는 하나");
  expect(result.bang).toEqual([JSON.stringify(["probe-b"])]);
  expect(result.symbol).toEqual([JSON.stringify(["probe-s", "grass"])]);
  expect(result.list).toEqual([JSON.stringify(["probe-l", [1, 2, "x"]])]);
  expect(result.message).toEqual([JSON.stringify(["probe-m", "step", ["grass", 0.5]])]);
  expect(errors).toEqual([]);
});
