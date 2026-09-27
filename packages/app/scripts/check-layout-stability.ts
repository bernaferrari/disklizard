/** Run with `bun packages/app/scripts/check-layout-stability.ts`. */
import assert from "node:assert/strict"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "@playwright/test"
import { createServer } from "vite"

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const server = await createServer({
  root: appRoot,
  configFile: resolve(appRoot, "vite.config.ts"),
  logLevel: "silent",
  server: { host: "127.0.0.1", port: 0 },
})

await server.listen()
const address = server.httpServer?.address()
assert(
  address && typeof address !== "string",
  "Fixture server did not bind a port"
)

const browser = await chromium.launch({ headless: true })
try {
  for (const viewport of [
    { width: 1019, height: 858 },
    { width: 760, height: 680 },
    { width: 420, height: 720 },
  ]) {
    const page = await browser.newPage({ viewport })
    try {
      await page.goto(`http://127.0.0.1:${address.port}/`)
      await page.getByRole("button", { name: /Scan Test volume/ }).click()

      const map = page.getByRole("region", { name: /Storage map/ })
      await map.waitFor({ state: "visible" })
      const before = await map.boundingBox()
      assert(before, "Storage map has no bounds before selection")

      // Focus follows a drag of a storage row and selects the item.
      await page.locator('[data-disk-index="0"]').focus()
      await page
        .getByText("Details", { exact: true })
        .waitFor({ state: "visible" })
      const after = await map.boundingBox()
      assert(after, "Storage map has no bounds after selection")

      const shift = Math.abs(
        before.y + before.height / 2 - after.y - after.height / 2
      )
      const resize = Math.abs(before.height - after.height)
      const dock = await page.locator(".dl-command-dock-inner").boundingBox()
      assert(
        dock && dock.width >= viewport.width - 40,
        "Command dock collapsed around its actions"
      )
      const selectedName = await page
        .locator(".dl-command-dock-inner span[title]")
        .boundingBox()
      assert(
        selectedName && selectedName.width >= 24,
        "Selected item name was squeezed out of the command dock"
      )
      console.log(
        `${viewport.width}×${viewport.height}: map center shift ${shift}px, height change ${resize}px`
      )
      assert(
        shift < 0.5 && resize < 0.5,
        "Selecting an item moved or resized the storage map"
      )
    } finally {
      await page.close()
    }
  }
} finally {
  await browser.close()
  await server.close()
}
