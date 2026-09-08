import { _electron, expect } from "@playwright/test"
import { resolve } from "node:path"

const executablePath = process.argv[2]
if (!executablePath) throw new Error("Pass the packaged Electron executable path")
const app = await _electron.launch({ executablePath: resolve(executablePath), timeout: 20_000 })
try {
  const page = await app.firstWindow()
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await expect(page.getByText("Macintosh HD", { exact: true }).first()).toBeVisible()
  // A mounted DOM alone misses missing Tailwind utilities in workspace builds.
  const styledFlex = await page.locator(".flex").evaluateAll((nodes) =>
    nodes.some((node) => getComputedStyle(node).display === "flex"),
  )
  expect(styledFlex).toBe(true)
  const details = page.getByRole("button", { name: "Volume details", exact: true }).first()
  await details.click()
  await expect(page.locator('[data-slot="popover-content"]')).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.locator('[data-slot="popover-content"]')).toBeHidden()
  expect(errors).toEqual([])
  await page.screenshot({ path: "/tmp/disklizard-react-startup.png" })
  console.log("PASS: styled home screen and volume-details popover; no renderer errors")
} finally {
  await app.close()
}
