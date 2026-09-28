import { storageMapColor, storageTileColor } from "./visual-palette"
import { describe, it, expect } from "bun:test"
import type { DiskScanNode } from "./types"
import {
  Sunburst,
  layoutSunburstSegments,
  MIN_VISIBLE_SEGMENT_ANGLE,
  primaryHueForIndex,
  primarySegmentColor,
  primarySegmentForeground,
  safeCanvasRadius,
  shouldPulseSunburstEntry,
  sunburstEntryDuration,
  sunburstTransitionDuration,
} from "./sunburst"

function oklchToLinearSrgb(css: string, clip = true): [number, number, number] {
  const channels = css.match(/oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)/)
  if (!channels)
    throw new Error(`Expected an opaque OKLCH color, received ${css}`)
  const lightness = Number(channels[1])
  const chroma = Number(channels[2])
  const hue = (Number(channels[3]) * Math.PI) / 180
  const a = chroma * Math.cos(hue)
  const b = chroma * Math.sin(hue)
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3
  const clamp = (channel: number) =>
    clip ? Math.max(0, Math.min(1, channel)) : channel
  return [
    clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ]
}

function contrastRatio(foreground: string, background: string): number {
  const luminance = (color: string) => {
    const [red, green, blue] = oklchToLinearSrgb(color)
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue
  }
  const values = [luminance(foreground), luminance(background)].sort(
    (a, b) => b - a
  )
  return (values[0] + 0.05) / (values[1] + 0.05)
}

function node(
  name: string,
  size: number,
  children: DiskScanNode[] = []
): DiskScanNode {
  return { name, path: `/${name}`, size, isDir: true, children, ext: "" }
}

describe("primaryHueForIndex", () => {
  it("moves through a stable curated palette", () => {
    expect([0, 1, 2, 3, 7, 10].map(primaryHueForIndex)).toEqual([
      198, 25, 158, 278, 165, 198,
    ])
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
  it("keeps every directory and file depth inside sRGB, including hover", () => {
    for (let index = 0; index < 10; index++) {
      for (let depth = 0; depth < 6; depth++) {
        for (const directory of [true, false]) {
          const css = primarySegmentColor(index, 1, directory, depth)
          const hover = css.replace(
            /oklch\(([\d.]+)/,
            (_, lightness) => `oklch(${Number(lightness) + 0.025}`
          )
          for (const color of [css, hover])
            for (const channel of oklchToLinearSrgb(color, false)) {
              expect(channel).toBeGreaterThanOrEqual(0)
              expect(channel).toBeLessThanOrEqual(1)
            }
        }
      }
    }
  })
  it("includes alpha when passed", () => {
    expect(primarySegmentColor(0, 0.5)).toContain("/ 0.5")
  })
  it("keeps files visually secondary to folder branches", () => {
    expect(primarySegmentColor(2, 1, false)).not.toBe(primarySegmentColor(2))
  })
  it("gives nested tiles distinct tones with readable labels", () => {
    for (let index = 0; index < 10; index++) {
      const colors = [0, 1, 2].map((depth) => storageTileColor(index, depth))
      expect(new Set(colors).size).toBe(3)
      for (const color of colors)
        expect(
          contrastRatio(primarySegmentForeground(), color)
        ).toBeGreaterThanOrEqual(4.5)
    }
  })

  it("keeps every tile label above normal-text AA contrast", () => {
    for (let index = 0; index < 10; index++) {
      for (let depth = 0; depth < 6; depth++) {
        for (const directory of [true, false])
          expect(
            contrastRatio(
              primarySegmentForeground(directory),
              primarySegmentColor(index, 1, directory, depth)
            )
          ).toBeGreaterThanOrEqual(4.5)
      }
    }
    expect(
      contrastRatio(
        primarySegmentForeground(false),
        primarySegmentColor(0, 1, false)
      )
    ).toBeGreaterThanOrEqual(4.5)
  })

  it("keeps dark theme fills and labels in gamut with readable contrast", () => {
    const previous = document.documentElement.dataset.colorScheme
    document.documentElement.dataset.colorScheme = "dark"
    try {
      for (let index = 0; index < 10; index++) {
        for (let depth = 0; depth < 9; depth++) {
          const color = primarySegmentColor(index, 1, true, depth)
          for (const channel of oklchToLinearSrgb(color, false)) {
            expect(channel).toBeGreaterThanOrEqual(0)
            expect(channel).toBeLessThanOrEqual(1)
          }
          expect(
            contrastRatio(primarySegmentForeground(), color)
          ).toBeGreaterThanOrEqual(4.5)
          expect(
            contrastRatio(
              primarySegmentForeground(),
              storageTileColor(index, depth)
            )
          ).toBeGreaterThanOrEqual(4.5)
        }
      }
    } finally {
      if (previous === undefined)
        delete document.documentElement.dataset.colorScheme
      else document.documentElement.dataset.colorScheme = previous
    }
  })

  it("keeps branch hues stable and files neutral across map depths", () => {
    for (let index = 0; index < 10; index++) {
      const branchHue = primaryHueForIndex(index)
      for (let depth = 0; depth < 9; depth++) {
        const folder = storageMapColor(index, depth)
        const file = storageMapColor(index, depth, false)
        expect(folder.endsWith(` ${branchHue})`)).toBe(true)
        expect(Number(file.match(/oklch\([\d.]+ ([\d.]+)/)?.[1])).toBeLessThan(
          0.02
        )
      }
    }
  })

  it("uses the same storage palette in both app themes", () => {
    const previous = document.documentElement.dataset.colorScheme
    try {
      for (let index = 0; index < 10; index++) {
        for (let depth = 0; depth < 9; depth++) {
          for (const directory of [true, false]) {
            document.documentElement.dataset.colorScheme = "light"
            const light = storageMapColor(index, depth, directory)
            const lightTile = primarySegmentColor(index, 1, directory, depth)
            const lightForeground = primarySegmentForeground(directory)
            document.documentElement.dataset.colorScheme = "dark"
            expect(storageMapColor(index, depth, directory)).toBe(light)
            expect(primarySegmentColor(index, 1, directory, depth)).toBe(
              lightTile
            )
            expect(primarySegmentForeground(directory)).toBe(lightForeground)
            for (const channel of oklchToLinearSrgb(light, false)) {
              expect(channel).toBeGreaterThanOrEqual(0)
              expect(channel).toBeLessThanOrEqual(1)
            }
            const hovered = light.replace(
              /oklch\(([\d.]+)/,
              (_, lightness) => `oklch(${Number(lightness) + 0.033}`
            )
            for (const channel of oklchToLinearSrgb(hovered, false)) {
              expect(channel).toBeGreaterThanOrEqual(0)
              expect(channel).toBeLessThanOrEqual(1)
            }
            expect(
              contrastRatio(lightForeground, lightTile)
            ).toBeGreaterThanOrEqual(4.5)
          }
        }
      }
    } finally {
      if (previous === undefined)
        delete document.documentElement.dataset.colorScheme
      else document.documentElement.dataset.colorScheme = previous
    }
  })
})

describe("safeCanvasRadius", () => {
  it("prevents transient resize and animation values from crashing canvas arc drawing", () => {
    expect(safeCanvasRadius(-Math.LN2)).toBe(0)
    expect(safeCanvasRadius(Number.NaN)).toBe(0)
    expect(safeCanvasRadius(Number.POSITIVE_INFINITY)).toBe(0)
    expect(safeCanvasRadius(42)).toBe(42)
  })
})

describe("sunburstTransitionDuration", () => {
  it("keeps repeated navigation faster than the one-time reveal", () => {
    expect(sunburstTransitionDuration("enter", false)).toBe(560)
    expect(sunburstTransitionDuration("drill", false)).toBe(240)
    expect(sunburstTransitionDuration("up", false)).toBe(240)
    expect(sunburstTransitionDuration("update", false)).toBe(240)
  })

  it("settles immediately for reduced motion", () => {
    expect(sunburstTransitionDuration("enter", true)).toBe(1)
    expect(sunburstTransitionDuration("drill", true, 900, 1200)).toBe(1)
  })

  it("settles keyboard navigation immediately without disabling pointer motion", () => {
    expect(sunburstTransitionDuration("drill", false, 240, 560, true)).toBe(1)
    expect(sunburstTransitionDuration("up", false, 240, 560, true)).toBe(1)
    expect(sunburstTransitionDuration("drill", false, 240, 560, false)).toBe(
      240
    )
  })
})

describe("sunburstEntryDuration", () => {
  it("reserves the full reveal for scan completion and keeps keyboard mode switches instant", () => {
    expect(sunburstEntryDuration("scan-complete")).toBe(560)
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
  it("can show eight retained levels when a chosen folder was scanned deeper", () => {
    let branch = node("leaf", 100)
    for (let depth = 9; depth >= 0; depth--)
      branch = node(`level-${depth}`, 100, [branch])
    expect(
      layoutSunburstSegments(branch, 8).map((segment) => segment.depth)
    ).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  })
  it("shows six levels by default without descending beyond the visible rings", () => {
    let branch = node("leaf", 100)
    for (let depth = 7; depth >= 0; depth--)
      branch = node(`level-${depth}`, 100, [branch])
    const segments = layoutSunburstSegments(branch)
    expect(segments.map((segment) => segment.depth)).toEqual([0, 1, 2, 3, 4, 5])
    expect(segments.every((segment) => segment.end - segment.start > 6)).toBe(
      true
    )
  })
  it("preserves every byte while grouping dense branches into readable segments", () => {
    const children = Array.from({ length: 48 }, (_, outer) =>
      node(
        `outer-${outer}`,
        48,
        Array.from({ length: 48 }, (_, inner) =>
          node(`outer-${outer}/inner-${inner}`, 1)
        )
      )
    )
    const segments = layoutSunburstSegments(
      node("root", 48 * 48, children),
      3,
      720
    )

    expect(segments.length).toBeLessThanOrEqual(720)
    const primary = segments.filter((segment) => segment.depth === 0)
    expect(primary).toHaveLength(24)
    expect(primary.reduce((sum, segment) => sum + segment.node.size, 0)).toBe(
      48 * 48
    )
    expect(primary.at(-1)?.node.otherCount).toBe(25)
  })

  it("preserves the angular position of items after sub-pixel siblings", () => {
    const root = node("root", 10_000, [
      node("large", 9_000),
      node("tiny", 1),
      node("last", 999),
    ])
    const segments = layoutSunburstSegments(root, 1)
    const large = segments.find((segment) => segment.node.name === "large")!
    const last = segments.find((segment) => segment.node.name === "last")!

    expect(last.start).toBeGreaterThanOrEqual(large.end)
  })

  it("aggregates huge primary levels without leaving unpainted storage", () => {
    const children = Array.from({ length: 1_000 }, (_, index) =>
      node(`item-${index}`, index + 1)
    )
    const segments = layoutSunburstSegments(
      node("root", 500_500, children),
      3,
      720
    )
    const primary = segments.filter((segment) => segment.depth === 0)

    expect(primary).toHaveLength(24)
    expect(primary.at(-1)?.node).toMatchObject({
      name: "",
      isOther: true,
      otherCount: 977,
    })
    expect(primary.reduce((sum, segment) => sum + segment.node.size, 0)).toBe(
      500_500
    )
    expect(primary.at(-1)?.end).toBeCloseTo(Math.PI * 1.5, 8)
  })

  it("rolls sub-pixel tails into a truthful segment instead of silently dropping their storage", () => {
    const root = node("root", 10_000, [
      node("large", 9_990),
      ...Array.from({ length: 10 }, (_, i) => node(`tiny-${i}`, 1)),
    ])
    const segments = layoutSunburstSegments(root, 1, 360)
    const primary = segments.filter((segment) => segment.depth === 0)
    const aggregate = primary.find((segment) => segment.node.isOther)

    expect(MIN_VISIBLE_SEGMENT_ANGLE).toBeGreaterThan(0)
    expect(aggregate).toMatchObject({
      node: { name: "", size: 10, isOther: true, otherCount: 10 },
    })
    expect(aggregate!.node.children).toHaveLength(10)
    expect(
      aggregate!.node.children.reduce((sum, child) => sum + child.size, 0)
    ).toBe(aggregate!.node.size)
    expect(primary.reduce((sum, segment) => sum + segment.node.size, 0)).toBe(
      root.size
    )
    expect(primary.at(-1)?.end).toBeCloseTo(Math.PI * 1.5, 8)
  })

  it("keeps a large multi-level scan inside its paint budget while retaining every top-level byte", () => {
    const children = Array.from({ length: 180 }, (_, outer) =>
      node(
        `outer-${outer}`,
        10_000 + outer,
        Array.from({ length: 80 }, (_, inner) =>
          node(`outer-${outer}/inner-${inner}`, 1 + inner)
        )
      )
    )
    const root = node(
      "root",
      children.reduce((sum, child) => sum + child.size, 0),
      children
    )
    const segments = layoutSunburstSegments(root, 3, 360)
    const primary = segments.filter((segment) => segment.depth === 0)

    expect(segments.length).toBeLessThanOrEqual(360)
    expect(primary.reduce((sum, segment) => sum + segment.node.size, 0)).toBe(
      root.size
    )
    expect(primary.every((segment) => segment.end > segment.start)).toBe(true)
  })
})

describe("sunburst resize", () => {
  it("keeps the map painted while native resize pauses animation frames", () => {
    const map = Object.create(Sunburst.prototype)
    let painted = true
    let width = 400
    let height = 400
    map.canvas = {
      get width() {
        return width
      },
      set width(value) {
        width = value
        painted = false
      },
      get height() {
        return height
      },
      set height(value) {
        height = value
        painted = false
      },
      getBoundingClientRect: () => ({ width: 800, height: 500 }),
    }
    map.ctx = {
      clearRect: () => {
        painted = false
      },
    } as unknown as CanvasRenderingContext2D
    map.options = { rings: 3, ringGap: 0.004 }
    map.segments = [{ depth: 0, opacity: 1 }] as Sunburst["segments"]
    map.animT = 1
    map._drawSegment = () => {
      painted = true
    }
    map._resize()
    expect(painted).toBe(true)
    expect(map.canvas.width / map.canvas.height).toBeCloseTo(800 / 500)
    expect(map.cx).toBe(map.canvas.width / 2)
    expect(map.cy).toBe(map.canvas.height / 2)
    expect(map.maxR).toBeCloseTo(map.canvas.height * 0.4)
  })

  it("tapers detail rings without gaps or overflow beyond the map extent", () => {
    const map = Object.create(Sunburst.prototype) as Sunburst
    map.options = { rings: 6, ringGap: 0.004 } as Sunburst["options"]
    map.maxR = 300
    map.innerHole = 87
    const rings = Array.from({ length: 6 }, (_, depth) =>
      map._radiiForDepth(depth)
    )
    expect(rings[0].inner).toBe(map.innerHole)
    expect(rings[5].outer).toBeCloseTo(map.maxR)
    for (let depth = 1; depth < rings.length; depth++) {
      expect(rings[depth].inner - rings[depth - 1].outer).toBeCloseTo(1.2)
      expect(rings[depth].outer - rings[depth].inner).toBeLessThan(
        rings[depth - 1].outer - rings[depth - 1].inner
      )
    }
  })
})

describe("sunburst navigation continuity", () => {
  function engine(root: DiskScanNode) {
    const map = Object.create(Sunburst.prototype) as Sunburst
    Object.assign(map, {
      root,
      viewNode: root,
      segments: [],
      innerHole: 87,
      maxR: 300,
      reducedMotion: false,
      lastFrame: 0,
      requestFrame: () => {},
      options: {
        rings: 6,
        maxSegments: 560,
        ringGap: 0.004,
        animMs: 240,
        enterAnimMs: 560,
      },
    })
    map.setData(root, null, true)
    map._tick(map.animStart + 2)
    return map
  }
  it("closes the gap around a collected wedge and restores it on undo", () => {
    const root = node("root", 100, [node("first", 40), node("second", 60)])
    const map = engine(root)
    const original = map.segments.find((segment) => segment.path === "/second")!
    const originalSpan = original.end - original.start

    map.setExcludedPaths(new Set(["/first"]))
    map._tick(map.animStart + 242)
    expect(map.segments.some((segment) => segment.path === "/first")).toBe(
      false
    )
    const remaining = map.segments.find(
      (segment) => segment.path === "/second"
    )!
    expect(remaining.end - remaining.start).toBeGreaterThan(originalSpan)
    expect(remaining.end - remaining.start).toBeCloseTo(Math.PI * 2, 1)

    map.setExcludedPaths(new Set())
    map._tick(map.animStart + 242)
    expect(map.segments.some((segment) => segment.path === "/first")).toBe(true)
    expect(
      map.segments.find((segment) => segment.path === "/second")!.end -
        map.segments.find((segment) => segment.path === "/second")!.start
    ).toBeCloseTo(originalSpan)
  })
  it("preserves a descendant's hue and tone when its parent becomes the viewport", () => {
    const child = { ...node("child", 10), path: "/branch/child" }
    const selected = node("branch", 10, [child])
    const root = node("root", 100, [node("large", 90), selected])
    const map = engine(root)
    const before = {
      ...map.segments.find((segment) => segment.path === child.path)!.toTone!,
    }
    map.navigateTo(selected)
    expect(
      map.segments.find((segment) => segment.path === child.path)!.toTone
    ).toEqual(before)
    map.navigateTo(root)
    expect(
      map.segments.find((segment) => segment.path === child.path)!.toTone
    ).toEqual(before)
  })
  const branch = () =>
    node("branch", 10, [node("inside", 10, [node("deep", 10)])])
  it("never inverts expanding arcs across the angular seam", () => {
    const selected = branch()
    const map = engine(node("root", 100, [node("large", 90), selected]))
    map.navigateTo(selected)
    const start = map.animStart
    const initialSpan = map.segments.find((s) => s.path === "/inside")!
    const before = initialSpan.end - initialSpan.start
    map._tick(start + 120)
    expect(initialSpan.end - initialSpan.start).toBeGreaterThan(before)
    for (let ms = 1; ms <= 240; ms += 8) {
      map._tick(start + ms)
      for (const segment of map.segments) {
        expect(segment.end).toBeGreaterThanOrEqual(segment.start)
        expect(segment.end - segment.start).toBeLessThanOrEqual(
          Math.PI * 2 + 1e-8
        )
      }
    }
  })
  it("moves surrounding wedges to the focus boundaries instead of the center", () => {
    const selected = branch()
    const map = engine(node("root", 100, [node("large", 90), selected]))
    map.navigateTo(selected)
    const exiting = map.segments.find((s) => s.path === "/large")!
    expect(exiting.toInner).toBe(exiting.fromInner)
    expect(exiting.toOuter).toBe(exiting.fromOuter)
    expect(exiting.toStart).toBe(exiting.toEnd)
  })
  it("retargets from the visible pose when another folder is opened mid-flight", () => {
    const selected = branch()
    const map = engine(node("root", 100, [node("large", 90), selected]))
    map.navigateTo(selected)
    map._tick(map.animStart + 90)
    const visible = { ...map.segments.find((s) => s.path === "/deep")! }
    map.navigateTo(selected.children[0])
    const next = map.segments.find((s) => s.path === "/deep")!
    expect(next.fromStart).toBe(visible.start)
    expect(next.fromEnd).toBe(visible.end)
    expect(next.fromInner).toBe(visible.inner)
    expect(next.fromOpacity).toBe(visible.opacity)
    expect(next.fromTone).toEqual(visible.tone)
  })
})
