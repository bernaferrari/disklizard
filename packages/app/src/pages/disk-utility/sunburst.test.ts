import { describe, it, expect } from "bun:test"
import { primaryHueForIndex, primarySegmentColor } from "./sunburst"

describe("primaryHueForIndex", () => {
  it("matches the golden-angle formula", () => {
    for (const i of [0, 1, 2, 3, 7, 13]) {
      expect(primaryHueForIndex(i)).toBeCloseTo((i * 137.508 + 24) % 360, 5)
    }
  })
  it("keeps consecutive hues distinct", () => {
    expect(primaryHueForIndex(0)).not.toBe(primaryHueForIndex(1))
    expect(primaryHueForIndex(1)).not.toBe(primaryHueForIndex(2))
  })
})

describe("primarySegmentColor", () => {
  it("renders an oklch string carrying the index hue", () => {
    const css = primarySegmentColor(2)
    expect(css.startsWith("oklch(")).toBe(true)
    expect(css).toContain(primaryHueForIndex(2).toFixed(1))
  })
  it("includes alpha when passed", () => {
    expect(primarySegmentColor(0, 0.5)).toContain("/ 0.5")
  })
})
