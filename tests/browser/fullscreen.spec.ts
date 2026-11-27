import { devices, expect, test } from "@playwright/test";

for (const mobile of [false, true]) {
  test(`full screen control on ${mobile ? "a touch viewport" : "desktop"}`, async ({ browser, browserName, baseURL }) => {
    const touchOptions = browserName === "webkit" ? devices["iPhone 13"] : {
      viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: browserName !== "firefox",
    };
    const context = await browser.newContext({ ...(mobile ? touchOptions : {}), baseURL, locale: "ko-KR" });
    try {
      const page = await context.newPage();
      await page.goto(`?meeting=fullscreen-${Date.now()}`);
      const toggle = page.getByRole("button", { name: "전체 화면", exact: true });
      const menuColor = await page.getByRole("button", { name: "다시 시작", exact: true })
        .evaluate(button => getComputedStyle(button).color);
      await expect(toggle.locator("svg")).toHaveCSS("stroke", menuColor);
      const activate = () => mobile ? toggle.tap() : toggle.click();
      await activate();
      if (mobile && browserName === "webkit" && await page.evaluate(() =>
        !("requestFullscreen" in document.documentElement) && !("webkitRequestFullscreen" in document.documentElement))) {
        await expect(page.getByRole("status").filter({ hasText: "홈 화면에 추가" })).toBeVisible();
        await expect(toggle).toHaveAttribute("aria-pressed", "false");
        return;
      }
      await expect(toggle).toHaveAttribute("aria-pressed", "true");
      expect(await page.evaluate(() => document.fullscreenElement === document.documentElement)).toBe(true);
      await page.getByRole("button", { name: "플레이", exact: true }).click();
      await expect(page.locator(".play-shell")).toBeVisible();
      await page.getByRole("button", { name: "만들기로 돌아가기" }).click();
      await expect(toggle).toHaveAttribute("aria-pressed", "true");
      await activate();
      await expect(toggle).toHaveAttribute("aria-pressed", "false");
      await activate();
      await expect(toggle).toHaveAttribute("aria-pressed", "true");
      await page.evaluate(() => document.exitFullscreen());
      await expect(toggle).toHaveAttribute("aria-pressed", "false");
    } finally {
      await context.close();
    }
  });
}

test("an iPhone without page fullscreen shows Home Screen instructions on tap", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, "fullscreenEnabled", { value: false });
    Object.defineProperty(document, "webkitFullscreenEnabled", { value: false });
    Object.defineProperty(navigator, "standalone", { value: false });
    Object.defineProperty(navigator, "maxTouchPoints", { value: 5 });
  });
  await page.goto(`?meeting=fullscreen-fallback-${Date.now()}`);
  const toggle = page.getByRole("button", { name: "전체 화면", exact: true });
  await toggle.click();
  await expect(page.getByRole("status").filter({ hasText: "홈 화면에 추가" })).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  const manifest = await page.locator('link[rel="manifest"]').getAttribute("href");
  const response = await page.request.get(new URL(manifest!, page.url()).href);
  expect((await response.json()).display).toBe("standalone");
});

test("uses the older Safari toggle and follows its fullscreen change event", async ({ page }) => {
  await page.addInitScript(() => {
    let active = false;
    const update = (value: boolean) => {
      active = value;
      document.dispatchEvent(new Event("webkitfullscreenchange"));
    };
    Object.defineProperties(document, {
      fullscreenEnabled: { value: false },
      webkitFullscreenEnabled: { value: true },
      webkitFullscreenElement: { get: () => active ? document.documentElement : null },
      webkitExitFullscreen: { value: () => update(false) },
    });
    Object.defineProperty(document.documentElement, "webkitRequestFullscreen", { value: () => update(true) });
  });
  await page.goto(`?meeting=fullscreen-webkit-${Date.now()}`);
  const toggle = page.getByRole("button", { name: "전체 화면", exact: true });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
});
