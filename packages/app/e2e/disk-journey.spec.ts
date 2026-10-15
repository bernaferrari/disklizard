import { expect, test } from "@playwright/test"
import { openFixtureScan } from "./disk-journey"

test("review and confirmation precede exact-path Trash intent", async ({
  page,
}) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await openFixtureScan(page)
  const archive = page.getByRole("button", {
    name: "Select Archive.zip for review",
    exact: true,
  })
  await archive.click()
  await expect(
    page.getByRole("button", { name: "Move to Trash…", exact: true })
  ).toBeEnabled()
  expect(await page.evaluate(() => window.diskLizardFixture.deleted)).toEqual(
    []
  )
  await page
    .getByRole("button", { name: "Move to Trash…", exact: true })
    .click()
  const review = page.getByRole("dialog", {
    name: "Move 1 item to Trash?",
    exact: true,
  })
  await expect(review).toBeVisible()
  await expect(review.getByText("Archive.zip", { exact: true })).toBeVisible()
  expect(
    await page.evaluate(() => window.diskLizardFixture.authorizationRequests)
  ).toEqual([])
  await review.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(review).toBeHidden()
  expect(await page.evaluate(() => window.diskLizardFixture.deleted)).toEqual(
    []
  )
  await page
    .getByRole("button", { name: "Move to Trash…", exact: true })
    .click()
  await review
    .getByRole("button", { name: "Move to Trash", exact: true })
    .click()
  await expect(review).toBeHidden()
  await expect(archive).toBeHidden()
  const state = await page.evaluate(() => ({
    authorized: window.diskLizardFixture.authorizationRequests,
    deleted: window.diskLizardFixture.deleted,
  }))
  expect(state.authorized).toEqual([["/Users/alex/Downloads/Archive.zip"]])
  expect(state.deleted).toEqual([
    {
      path: "/Users/alex/Downloads/Archive.zip",
      options: {
        authorization: "fixture-authorization-0",
        historyMetadata: { estimatedBytes: 280 * 1024 * 1024, kind: "file" },
      },
    },
  ])
  await expect(
    page.getByRole("status").filter({ hasText: "No items selected for review" })
  ).toBeVisible()
  expect(errors).toEqual([])
})

test("keyboard expands a collapsed folder and restores browse history", async ({
  page,
}) => {
  await openFixtureScan(page)
  const workspace = page.getByRole("button", { name: /^Nested workspace\s+16/ })
  await workspace.focus()
  await workspace.press("ArrowRight")
  const payload = page.getByRole("button", { name: /^Payload\s+16/ })
  await expect(payload).toBeEnabled()
  await payload.press("ArrowRight")
  await expect(
    page.getByRole("button", { name: /^deep-artifact\.bin\s+16/ })
  ).toBeVisible()
  await expect(
    page.getByRole("navigation", { name: "Current location", exact: true })
  ).toContainText("Payload")
  const previous = page.getByRole("button", {
    name: "Previous location",
    exact: true,
  })
  await expect(previous).toBeEnabled()
  await previous.click()
  await expect(payload).toBeEnabled()
  const next = page.getByRole("button", { name: "Next location", exact: true })
  await expect(next).toBeEnabled()
  await next.click()
  await expect(
    page.getByRole("button", { name: /^deep-artifact\.bin\s+16/ })
  ).toBeVisible()
})

test("switching workspaces during a map transition restores usable tiles", async ({
  page,
}) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.emulateMedia({ reducedMotion: "no-preference" })
  await openFixtureScan(page)
  const tiles = page.getByRole("button", { name: "Tiles", exact: true })
  const map = page.getByRole("button", { name: "Map", exact: true })
  await tiles.click()
  await map.click()
  await expect(map).toHaveAttribute("aria-pressed", "true")
  await tiles.click()
  await page.getByRole("button", { name: "Clean up", exact: true }).click()
  await page.getByRole("button", { name: "Explore", exact: true }).click()
  const archiveTile = page
    .getByRole("group", {
      name: "Tile view of this folder. Small items remain available in the list.",
      exact: true,
    })
    .getByRole("button", { name: /^Archive\.zip ·/ })
  await expect(archiveTile).toBeEnabled()
  await archiveTile.click()
  await expect(archiveTile).toHaveAttribute("aria-pressed", "true")
  await expect(tiles).toHaveAttribute("aria-pressed", "true")
  expect(errors).toEqual([])
})
