import { expect, type Page } from "@playwright/test"
import type {} from "../src/fixture"

export async function openFixtureScan(page: Page) {
  await page.goto("/?journey=1")
  const scan = page.getByRole("button", {
    name: "Scan Test volume, 218 MB left",
    exact: true,
  })
  await expect(scan).toBeEnabled()
  await scan.click()
  await expect(
    page.getByRole("button", {
      name: "Select Archive.zip for review",
      exact: true,
    })
  ).toBeEnabled()
  await expect(
    page.getByRole("button", { name: "Clean up", exact: true })
  ).toBeEnabled()
}
