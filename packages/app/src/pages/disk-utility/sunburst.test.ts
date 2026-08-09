import { describe, it, expect } from "bun:test"
import type { DiskScanNode } from "@/context/platform"
import {
  layoutSunburstSegments,
  primaryHueForIndex,
  primarySegmentColor,
  shouldPulseSunburstEntry,
  sunburstEntryDuration,
  sunburstTransitionDuration,
} from "./sunburst"

function node(name: string, size: number, children: DiskScanNode[] = []): DiskScanNode {
  return { name, path: `/${name}`, size, isDir: true, children, ext: "" }
}

describe("primaryHueForIndex", () => {
  it("moves through a stable chromatic sweep", () => {
    for (const i of [0, 1, 2, 3, 7, 13]) {
      expect(primaryHueForIndex(i)).toBeCloseTo((148 + i * 31) % 360, 5)
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

describe("sunburstTransitionDuration", () => {
  it("keeps repeated navigation faster than the one-time reveal", () => {
    expect(sunburstTransitionDuration("enter", false)).toBe(340)
    expect(sunburstTransitionDuration("drill", false)).toBe(240)
    expect(sunburstTransitionDuration("up", false)).toBe(240)
    expect(sunburstTransitionDuration("update", false)).toBe(240)
  })

  it("settles immediately for reduced motion", () => {
    expect(sunburstTransitionDuration("enter", true)).toBe(1)
    expect(sunburstTransitionDuration("drill", true, 900, 1200)).toBe(1)
  })

  it("settles keyboard navigation immediately without disabling pointer motion", () => {
    expect(sunburstTransitionDuration("drill", false, 240, 340, true)).toBe(1)
    expect(sunburstTransitionDuration("up", false, 240, 340, true)).toBe(1)
    expect(sunburstTransitionDuration("drill", false, 240, 340, false)).toBe(240)
  })
})

describe("sunburstEntryDuration", () => {
  it("reserves the full reveal for scan completion and keeps keyboard mode switches instant", () => {
    expect(sunburstEntryDuration("scan-complete")).toBe(340)
    expect(sunburstEntryDuration("pointer")).toBe(240)
    expect(sunburstEntryDuration("keyboard")).toBe(1)
  })

  it("suppresses the entrance halo for keyboard and reduced-motion reveals", () => {
    expect(shouldPulseSunburstEntry("enter", false, false)).toBe(true)
    expect(shouldPulseSunburstEntry("enter", false, true)).toBe(false)
    expect(shouldPulseSunburstEntry("enter", true, false)).toBe(false)
    expect(shouldPulseSunburstEntry("drill", false, false)).toBe(false)
  })
})

describe("layoutSunburstSegments", () => {
  it("keeps every primary segment while bounding deep paint work", () => {
    const children = Array.from({ length: 48 }, (_, outer) =>
      node(
        `outer-${outer}`,
        48,
        Array.from({ length: 48 }, (_, inner) => node(`outer-${outer}/inner-${inner}`, 1)),
      ),
    )
    const segments = layoutSunburstSegments(node("root", 48 * 48, children), 3, 720)

    expect(segments).toHaveLength(720)
    expect(segments.filter((segment) => segment.depth === 0)).toHaveLength(48)
  })

  it("preserves the angular position of items after sub-pixel siblings", () => {
    const root = node("root", 10_000, [node("large", 9_000), node("tiny", 1), node("last", 999)])
    const segments = layoutSunburstSegments(root, 1)
    const large = segments.find((segment) => segment.node.name === "large")!
    const last = segments.find((segment) => segment.node.name === "last")!

    expect(last.start).toBeGreaterThan(large.end)
  })

  it("aggregates huge primary levels without leaving unpainted storage", () => {
    const children = Array.from({ length: 1_000 }, (_, index) => node(`item-${index}`, index + 1))
    const segments = layoutSunburstSegments(node("root", 500_500, children), 3, 720)
    const primary = segments.filter((segment) => segment.depth === 0)

    expect(primary).toHaveLength(240)
    expect(primary.at(-1)?.node).toMatchObject({ name: "761 smaller items", isOther: true })
    expect(primary.reduce((sum, segment) => sum + segment.node.size, 0)).toBe(500_500)
    expect(primary.at(-1)?.end).toBeCloseTo(Math.PI * 1.5, 8)
  })
})
