import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page } from "@playwright/test"

async function openStorageMap(page: Page) {
  await page.goto("/")
  const scan = page.getByRole("button", { name: /^Scan Test volume/ })
  await expect(scan).toBeEnabled()
  await scan.click()
  // The map opens automatically when the scan completes (2-step flow).
  await expect(page.getByRole("region", { name: /^Storage map for Test volume/ })).toBeVisible()
}

test("scans, reviews, and moves the exact reviewed item to Trash", async ({ page }) => {
  await openStorageMap(page)

  await page.getByRole("button", { name: "Select Build cache for review" }).click()
  await page.getByRole("button", { name: "Review selected" }).click()

  const review = page.getByRole("dialog", { name: /360 MB across 1 item/ })
  await expect(review).toBeVisible()
  await expect(review).toBeFocused()
  await review.getByRole("button", { name: "Move to Trash" }).click()
  await expect(review).toBeHidden()

  await expect
    .poll(() =>
      page.evaluate(() => ({
        authorizationRequests: window.diskLizardFixture.authorizationRequests,
        deleted: window.diskLizardFixture.deleted,
      })),
    )
    .toEqual({
      authorizationRequests: [["/Users/alex/Projects/sample/.cache"]],
      deleted: [
        {
          path: "/Users/alex/Projects/sample/.cache",
          options: { authorization: "fixture-authorization-0" },
        },
      ],
    })
  await expect(page.getByRole("button", { name: "Select Build cache for review" })).toHaveCount(0)
})

test("supports keyboard review in a narrow reduced-motion layout", async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 820 })
  await page.emulateMedia({ reducedMotion: "reduce" })
  await openStorageMap(page)

  await page.getByRole("button", { name: "List" }).click()
  const row = page.getByRole("button").filter({ hasText: "Archive.zip" })
  await expect(row).toHaveCount(1)
  await row.focus()
  await row.press("c")
  await expect(page.getByRole("button", { name: "Review selected" })).toBeVisible()

  const layout = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
    animations:
      document
        .querySelector<HTMLElement>(".dl-shell")
        ?.getAnimations({ subtree: true })
        .filter((animation) => animation.playState === "running").length ?? -1,
  }))
  expect(layout.content).toBeLessThanOrEqual(layout.viewport)
  expect(layout.animations).toBe(0)
})

test("moves backward and forward through visited folders", async ({ page }) => {
  await openStorageMap(page)

  const back = page.locator("[data-disk-history-back]")
  const forward = page.locator("[data-disk-history-forward]")
  await expect(back).toBeDisabled()
  await expect(forward).toBeDisabled()

  await page.locator("[data-disk-index]").filter({ hasText: "Build cache" }).dblclick()
  await expect(page.getByRole("heading", { name: "Build cache" })).toBeVisible()
  await expect(back).toBeEnabled()

  await back.click()
  await expect(page.getByRole("heading", { name: "Test volume" })).toBeVisible()
  await expect(forward).toBeEnabled()

  await forward.click()
  await expect(page.getByRole("heading", { name: "Build cache" })).toBeVisible()

  await page.keyboard.press("Alt+ArrowLeft")
  await expect(page.getByRole("heading", { name: "Test volume" })).toBeVisible()
})

test("expands a scanner Other bucket through a bounded trusted parent rescan", async ({ page }) => {
  await openStorageMap(page)

  const aggregate = page.locator("[data-disk-index]").filter({ hasText: "40 smaller items" })
  await expect(aggregate).toBeVisible()
  await aggregate.dblclick()

  await page.getByRole("searchbox", { name: "Search this scan" }).fill("small-40.bin")
  await expect(page.locator("[data-disk-index]").filter({ hasText: "small-40.bin" })).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.diskLizardFixture.stopWatchingRequests.length)).toBeGreaterThan(0)
  const handoff = await page.evaluate(() => ({
    request: window.diskLizardFixture.scanRequests.at(-1),
    stop: window.diskLizardFixture.stopWatchingRequests.at(-1),
  }))
  if (!handoff.request) throw new Error("Focused scan request was not recorded")
  expect(handoff.request).toEqual({
    path: "/Users/alex",
    scanId: expect.stringMatching(/^expand-/),
    maxChildren: 43,
  })
  expect(handoff.stop).toEqual({ scanId: handoff.request.scanId, retainTrustedSubtree: true })
})

test("rebases focused scans over watcher updates and hands off nested scan authority", async ({ page }) => {
  await openStorageMap(page)
  const nestedWorkspacePath = "/Users/alex/Projects/nested-workspace"
  const nestedPayloadPath = `${nestedWorkspacePath}/Payload`
  await page.evaluate((path) => window.diskLizardFixture.holdNextScan(path), nestedWorkspacePath)

  await page.locator("[data-disk-index]").filter({ hasText: "Nested workspace" }).dblclick()
  await expect
    .poll(() => page.evaluate(() => window.diskLizardFixture.scanRequests.at(-1)?.path))
    .toBe(nestedWorkspacePath)
  await page.evaluate(() => {
    window.diskLizardFixture.emitArchiveGrowth()
    window.diskLizardFixture.releaseHeldScan()
  })

  await expect(page.getByRole("heading", { name: "Nested workspace" })).toBeVisible()
  await expect(page.getByText("Physical reclaim estimate paused", { exact: true })).toBeVisible()
  await page.locator("[data-disk-index]").filter({ hasText: "Payload" }).dblclick()
  await expect(page.getByRole("heading", { name: "Payload" })).toBeVisible()
  await expect(page.locator("[data-disk-index]").filter({ hasText: "deep-artifact.bin" })).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.diskLizardFixture.stopWatchingRequests.length)).toBe(2)

  const handoffs = await page.evaluate(() => ({
    requests: window.diskLizardFixture.scanRequests.slice(-2),
    stops: window.diskLizardFixture.stopWatchingRequests.slice(-2),
  }))
  expect(handoffs.requests).toEqual([
    {
      path: nestedWorkspacePath,
      scanId: expect.stringMatching(/^expand-/),
      maxChildren: 48,
    },
    {
      path: nestedPayloadPath,
      scanId: expect.stringMatching(/^expand-/),
      maxChildren: 48,
    },
  ])
  expect(handoffs.stops).toEqual(
    handoffs.requests.map(({ scanId }) => ({ scanId, retainTrustedSubtree: true })),
  )

  await page.keyboard.press("Alt+ArrowLeft")
  await page.keyboard.press("Alt+ArrowLeft")
  await expect(page.getByRole("heading", { name: "Test volume" })).toBeVisible()
  await expect(page.locator("[data-disk-index]").filter({ hasText: /Archive\.zip.*300 MB/ })).toBeVisible()
})

test("shows bounded before-and-after watcher history", async ({ page }) => {
  await openStorageMap(page)
  await page.evaluate(() => window.diskLizardFixture.emitBuildCacheGrowth())

  await page.getByText("Explore this scan", { exact: true }).click()
  await page.getByRole("button", { name: "History" }).click()
  await expect(page.getByText("Storage changes", { exact: true })).toBeVisible()
  const history = page.getByRole("list", { name: "Storage change history" })
  await expect(history.getByText("Build cache", { exact: true })).toBeVisible()
  await expect(history.getByText("+40.0 MB", { exact: true })).toBeVisible()
  await expect(history.getByText(/360 MB.*400 MB/)).toBeVisible()

  await page.getByRole("searchbox", { name: "Search change history" }).fill("Archive.zip")
  await expect(page.getByText("No matching changes", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Clear filter" }).click()
  await page.getByRole("button", { name: "Clear history" }).click()
  await expect(page.getByText("No live changes yet", { exact: true })).toBeVisible()
})

test("has no automated WCAG A/AA violations on the completed map", async ({ page }) => {
  await openStorageMap(page)
  const results = await new AxeBuilder({ page })
    .include(".dl-shell")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze()

  expect(results.violations).toEqual([])
})
