import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: ".",
  outputDir: "test-results/browser",
  workers: 1,
  retries: 0,
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:4187",
    viewport: { width: 1280, height: 900 },
    reducedMotion: "reduce",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "journey", testMatch: "disk-journey.spec.ts" },
    { name: "benchmark", testMatch: "performance/disk-ui.spec.ts" },
  ],
  webServer: {
    command: "bun run preview --host 127.0.0.1 --port 4187 --strictPort",
    url: "http://127.0.0.1:4187",
    reuseExistingServer: false,
  },
})
