import { defineConfig, devices } from "@playwright/test"

const port = Number(process.env.PLAYWRIGHT_DISK_UTILITY_PORT ?? 4318)
const executablePath = process.env.PLAYWRIGHT_CHROME_EXECUTABLE

export default defineConfig({
  testDir: ".",
  testMatch: "disk-utility.spec.ts",
  outputDir: "../test-results/disk-utility",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: "line",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  webServer: {
    command: `bunx vite --config vite.config.ts --host 127.0.0.1 --port ${port} --strictPort`,
    cwd: import.meta.dirname,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
  },
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(executablePath ? { launchOptions: { executablePath } } : {}),
      },
    },
  ],
})
