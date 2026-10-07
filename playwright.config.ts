import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:3100";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 60_000,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  snapshotPathTemplate: "{testDir}/{testFilePath}-snapshots/{arg}-{projectName}-{platform}{ext}",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    contextOptions: { reducedMotion: "reduce" },
  },
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01 } },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium-desktop-public",
      testMatch: /public-platform\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium-mobile-public",
      testMatch: /public-platform\.spec\.ts/,
      use: { ...devices["iPhone 13"], browserName: "chromium" },
    },
    {
      name: "chromium-desktop-authenticated",
      testMatch: /authenticated-journeys\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], storageState: ".auth/user.json" },
      dependencies: ["setup"],
    },
    {
      name: "chromium-mobile-authenticated",
      testMatch: /authenticated-journeys\.spec\.ts/,
      use: { ...devices["iPhone 13"], browserName: "chromium", storageState: ".auth/user.json" },
      dependencies: ["setup"],
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: process.env.E2E_STATIC_SERVER
          ? "node scripts/serve-static-e2e.mjs"
          : "node scripts/run-next-with-system-ca.mjs dev --hostname 127.0.0.1 --port 3100",
        url: process.env.E2E_STATIC_SERVER ? `${baseURL}/style-guide.html` : `${baseURL}/api/health/live`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
