import { defineConfig } from "@playwright/test"
import config from "./playwright.config"

export default defineConfig({
  ...config,
  testMatch: "disk-utility.benchmark.spec.ts",
  outputDir: "../test-results/disk-utility-benchmark",
  retries: 0,
  reporter: "line",
  webServer: {
    command:
      "bunx vite build --config vite.config.ts && bunx vite preview --config vite.config.ts --host 127.0.0.1 --port 4319 --strictPort",
    cwd: import.meta.dirname,
    url: "http://127.0.0.1:4319",
    reuseExistingServer: false,
  },
  use: {
    ...config.use,
    baseURL: "http://127.0.0.1:4319",
  },
})
