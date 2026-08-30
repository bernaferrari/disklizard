import { describe, expect, it } from "bun:test"

const css = await Bun.file(new URL("./dropdown-menu.css", import.meta.url)).text()

describe("dropdown menu accessibility", () => {
  it("uses explicit motion properties", () => {
    expect(css).not.toMatch(/transition\s*:\s*all\b/i)
    expect(css).toContain("animation: dropdown-menu-open 0.15s ease-out")
    expect(css).toContain("animation: dropdown-menu-close 0.15s ease-out")
  })

  it("disables portalled menu motion globally when reduced motion is requested", () => {
    const reducedMotion = css.match(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/)?.[1]

    expect(reducedMotion).toContain('[data-component="dropdown-menu-content"]')
    expect(reducedMotion).toContain('[data-component="dropdown-menu-sub-content"]')
    expect(reducedMotion).toContain("animation: none !important")
    expect(reducedMotion).toContain("transition: none !important")
    expect(reducedMotion).not.toContain(".dl-shell")
  })

  it("gives every coarse-pointer menu action a 44px target", () => {
    const coarsePointer = css.match(/@media \(pointer: coarse\) \{([\s\S]*?)\n\}/)?.[1]

    expect(coarsePointer).toContain('[data-slot="dropdown-menu-item"]')
    expect(coarsePointer).toContain('[data-slot="dropdown-menu-checkbox-item"]')
    expect(coarsePointer).toContain('[data-slot="dropdown-menu-radio-item"]')
    expect(coarsePointer).toContain('[data-slot="dropdown-menu-sub-trigger"]')
    expect(coarsePointer).toContain("min-height: 44px")
    expect(coarsePointer).toContain("touch-action: manipulation")
  })
})
