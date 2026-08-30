import { describe, expect, it } from "bun:test"

const css = await Bun.file(new URL("./toast.css", import.meta.url)).text()

describe("toast motion and placement", () => {
  it("transitions only the properties the toast actually animates", () => {
    expect(css).not.toMatch(/transition\s*:\s*all\b/i)
    expect(css).toContain("opacity 150ms ease-out")
    expect(css).toContain("transform 150ms ease-out")
  })

  it("disables toast motion globally when reduced motion is requested", () => {
    const reducedMotion = css.match(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/)?.[1]

    expect(reducedMotion).toContain('[data-component="toast"]')
    expect(reducedMotion).toContain('[data-slot="toast-progress-fill"]')
    expect(reducedMotion).toContain("animation: none !important")
    expect(reducedMotion).toContain("transition: none !important")
    expect(reducedMotion).not.toContain(".dl-shell")
  })

  it("bounds DiskLizard toasts above the cleanup dock", () => {
    expect(css).toContain('body:has(.dl-shell) [data-component="toast-region"]')
    expect(css).toMatch(/top:\s*72px;/)
    expect(css).toMatch(/bottom:\s*96px;/)
    expect(css).toMatch(/@media \(max-width: 760px\)[\s\S]*bottom:\s*176px;/)
  })
})
