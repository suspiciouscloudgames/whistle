import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  workers: 1,
  outputDir: "output/playwright",
  use: {
    baseURL: "http://127.0.0.1:5189/whistle/",
    locale: "ko-KR",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- --port 5189 --strictPort",
    url: "http://127.0.0.1:5189/whistle/",
    reuseExistingServer: false,
  },
});
