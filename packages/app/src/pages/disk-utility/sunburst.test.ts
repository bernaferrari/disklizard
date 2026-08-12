import { describe, it, expect } from "bun:test"
import type { DiskScanNode } from "@/context/platform"
import {
  layoutSunburstSegments,
  MIN_VISIBLE_SEGMENT_ANGLE,
  primaryHueForIndex,
  primarySegmentColor,
  safeCanvasRadius,
  shouldPulseSunburstEntry,
  sunburstEntryDuration,
  sunburstTransitionDuration,
} from "./sunburst"

function node(name: string, size: number, children: DiskScanNode[] = []): DiskScanNode {
  return { name, path: `/${name}`, size, isDir: true, children, ext: "" }
}

describe("primaryHueForIndex", () => {
  it("moves through a stable curated palette", () => {
    expect([0, 1, 2, 3, 7, 10].map(primaryHueForIndex)).toEqual([252, 318, 32, 205, 15, 252])
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
  it("keeps files visually secondary to folder branches", () => {
    expect(primarySegmentColor(2, 1, false)).toBe("oklch(0.56 0.018 255)")
  })
})

describe("safeCanvasRadius", () => {
  it("prevents transient resize and animation values from crashing canvas arc drawing", () => {
    expect(safeCanvasRadius(-0.6931)).toBe(0)
    expect(safeCanvasRadius(Number.NaN)).toBe(0)
    expect(safeCanvasRadius(Number.POSITIVE_INFINITY)).toBe(0)
    expect(safeCanvasRadius(42)).toBe(42)
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

    expect(last.start).toBeGreaterThanOrEqual(large.end)
  })

  it("aggregates huge primary levels without leaving unpainted storage", () => {
    const children = Array.from({ length: 1_000 }, (_, index) => node(`item-${index}`, index + 1))
    const segments = layoutSunburstSegments(node("root", 500_500, children), 3, 720)
    const primary = segments.filter((segment) => segment.depth === 0)

    expect(primary).toHaveLength(120)
    expect(primary.at(-1)?.node).toMatchObject({ name: "881 smaller items", isOther: true })
    expect(primary.reduce((sum, segment) => sum + segment.node.size, 0)).toBe(500_500)
    expect(primary.at(-1)?.end).toBeCloseTo(Math.PI * 1.5, 8)
  })

  it("rolls sub-pixel tails into a truthful segment instead of silently dropping their storage", () => {
    const root = node("root", 10_000, [node("large", 9_990), ...Array.from({ length: 10 }, (_, i) => node(`tiny-${i}`, 1))])
    const segments = layoutSunburstSegments(root, 1, 360)
    const primary = segments.filter((segment) => segment.depth === 0)
    const aggregate = primary.find((segment) => segment.node.isOther)

    expect(MIN_VISIBLE_SEGMENT_ANGLE).toBeGreaterThan(0)
    expect(aggregate).toMatchObject({ node: { name: "10 smaller items", size: 10, isOther: true } })
    expect(primary.reduce((sum, segment) => sum + segment.node.size, 0)).toBe(root.size)
    expect(primary.at(-1)?.end).toBeCloseTo(Math.PI * 1.5, 8)
  })

  it("keeps a large multi-level scan inside its paint budget while retaining every top-level byte", () => {
    const children = Array.from({ length: 180 }, (_, outer) =>
      node(
        `outer-${outer}`,
        10_000 + outer,
        Array.from({ length: 80 }, (_, inner) => node(`outer-${outer}/inner-${inner}`, 1 + inner)),
      ),
    )
    const root = node("root", children.reduce((sum, child) => sum + child.size, 0), children)
    const segments = layoutSunburstSegments(root, 3, 360)
    const primary = segments.filter((segment) => segment.depth === 0)

    expect(segments.length).toBeLessThanOrEqual(360)
    expect(primary.reduce((sum, segment) => sum + segment.node.size, 0)).toBe(root.size)
    expect(primary.every((segment) => segment.end > segment.start)).toBe(true)
  })
})
