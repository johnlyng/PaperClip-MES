import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration for MES E2E tests.
 *
 * Tests run against the full Docker Compose stack (docker compose up).
 * The BASE_URL env var controls the target; defaults to local dev stack.
 *
 * Run via: pnpm test:e2e
 * CI path: .github/workflows/ci.yml (only on PRs touching apps/ or e2e/)
 */
export default defineConfig({
  testDir: "./tests",
  outputDir: "./test-results",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false, // E2E tests share Docker Compose stack state
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 1 : 0,
  workers: 1, // Single worker to avoid DB state conflicts
  reporter: process.env["CI"]
    ? [["github"], ["html", { outputFolder: "playwright-report", open: "never" }]]
    : [["list"], ["html", { outputFolder: "playwright-report", open: "on-failure" }]],
  use: {
    baseURL: process.env["BASE_URL"] ?? "http://localhost:5173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1920, height: 1080 },
      },
    },
    {
      name: "chromium-1280",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
      },
    },
  ],
});
