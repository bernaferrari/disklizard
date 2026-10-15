import { expect, test } from "@playwright/test"
import { mkdir, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { openFixtureScan } from "../disk-journey"

test("collect completed production interaction measurements", async ({
  browser,
}, info) => {
  const runs = []
  for (let run = 0; run < 5; run++) {
    const context = await browser.newContext({
      baseURL: "http://127.0.0.1:4187",
      viewport: { width: 1280, height: 900 },
      reducedMotion: "reduce",
    })
    try {
      const page = await context.newPage()
      const errors: string[] = []
      page.on("pageerror", (error) => errors.push(error.message))
      const started = performance.now()
      await openFixtureScan(page)
      const scanToUsableMs = performance.now() - started
      const tilesStarted = performance.now()
      await page.getByRole("button", { name: "Tiles", exact: true }).click()
      await expect(
        page.getByRole("button", { name: "Tiles", exact: true })
      ).toHaveAttribute("aria-pressed", "true")
      const tilesReadyMs = performance.now() - tilesStarted
      const cleanupStarted = performance.now()
      await page.getByRole("button", { name: "Clean up", exact: true }).click()
      await expect(
        page.getByRole("checkbox", {
          name: "Select web / node_modules for review",
          exact: true,
        })
      ).toBeEnabled()
      const cleanupReadyMs = performance.now() - cleanupStarted
      expect(errors).toEqual([])
      runs.push({ scanToUsableMs, tilesReadyMs, cleanupReadyMs })
    } finally {
      await context.close()
    }
  }
  const report = {
    workload:
      "production browser fixture; Playwright action/assertion latency; reduced motion",
    runs,
  }
  const directory = resolve("../../test-results")
  await mkdir(directory, { recursive: true })
  await writeFile(
    resolve(directory, "disk-ui-benchmark.json"),
    `${JSON.stringify(report, null, 2)}\n`
  )
  await info.attach("interaction-measurements", {
    body: JSON.stringify(report),
    contentType: "application/json",
  })
  console.log(JSON.stringify(report))
})
