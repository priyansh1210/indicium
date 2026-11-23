import { defineConfig, devices } from "@playwright/test";

// End-to-end tests run against a running stack (`docker compose up --build --wait`), as people
// use it. BASE_URL points elsewhere when needed. Browsers: `pnpm exec playwright install chromium`.
export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1, // the tests decide real cases, so they run one after another
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:8080", // through the proxy, as people arrive
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7"] }, testMatch: /layout\.spec\.ts/ },
  ],
});
