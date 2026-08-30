import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

describe("cleanup-protection reset recovery", () => {
  test("requires two in-app confirmation steps with accessible focus and announcements", () => {
    const dialog = readFileSync(new URL("./DiskUtilityDialogs.tsx", import.meta.url), "utf8")
    expect(dialog).toContain('createSignal<"review" | "confirm">("review")')
    expect(dialog).toContain('when={step() === "confirm"}')
    expect(dialog).toContain("data-reset-confirm")
    expect(dialog).toContain('role="alertdialog"')
    expect(dialog).toContain('aria-live={step() === "confirm" || failed() ? "assertive" : "polite"}')
    expect(dialog).toContain("focusFinalAction()")
    expect(dialog).not.toContain("window.confirm")
  })

  test("wires reset through the error-only runtime recovery method", () => {
    const page = readFileSync(new URL("./index.tsx", import.meta.url), "utf8")
    expect(page).toContain("cleanupResetSurface.open()")
    expect(page).toContain("settings.general.resetDiskCleanupLocks()")
    expect(page).not.toContain("window.confirm")
  })
})
