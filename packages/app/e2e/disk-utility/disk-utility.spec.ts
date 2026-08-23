import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page } from "@playwright/test"

async function openStorageMap(page: Page) {
  await page.goto("/")
  const scan = page.getByRole("button", { name: /^Scan Test volume/ })
  await expect(scan).toBeEnabled()
  await scan.click()
  const view = page.getByRole("button", { name: "View map of Test volume" })
  await expect(view).toBeEnabled()
  await view.click()
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
