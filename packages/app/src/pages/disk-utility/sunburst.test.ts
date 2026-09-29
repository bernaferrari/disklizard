import {
  storageMapColor,
  storageSummaryColor,
  storageTileColor,
} from "./visual-palette"
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
  sunburstNodeTone,
  sunburstSegmentPadding,
  sunburstTransitionDuration,
} from "./sunburst"

it("uses the retained branch hue for a visual smaller-items arc", () => {
  const member = node("package", 10)
  const summary = {
    ...node("smaller items", 10, [member]),
    isOther: true,
    path: "disklizard:mosaic-more:package",
  }
  const tone = sunburstNodeTone(summary, 1, 350, (candidate) =>
    candidate === member ? { L: 0.7, C: 0.1, h: 210 } : undefined
  )
  expect(tone.h).toBe(210)
  expect(tone.C).toBeGreaterThan(0.05)
})

describe("map-to-tiles arc geometry", () => {
  it("uses the painted map's depth-sensitive gap, including narrow arcs", () => {
    expect(sunburstSegmentPadding({ start: 0, end: 1, depth: 0 }, 0.001)).toBe(
      0.005
    )
    expect(sunburstSegmentPadding({ start: 0, end: 1, depth: 1 }, 0.001)).toBe(
      0.0025
    )
    expect(sunburstSegmentPadding({ start: 0, end: 1, depth: 2 }, 0.001)).toBe(
      0.001
    )
    expect(
      sunburstSegmentPadding({ start: 0, end: 0.01, depth: 0 }, 0.001)
    ).toBeCloseTo(0.0022)
  })
})

describe("map hover", () => {
  it("adds only a subtle white wash without moving or outlining the arc", () => {
    const radii: number[] = []
    const fills: string[] = []
    let strokes = 0
    const context = {
      fillStyle: "",
      save() {},
      restore() {},
      beginPath() {},
      closePath() {},
      arc(_x: number, _y: number, radius: number) {
        radii.push(radius)
      },
      fill() {
        fills.push(this.fillStyle)
      },
      stroke() {
        strokes++
      },
    }
    const map = Object.create(Sunburst.prototype) as Sunburst
    map.ctx = context as unknown as CanvasRenderingContext2D
    map.options = { padAngle: 0.001 } as Sunburst["options"]
    map.dpr = 1
    map.cx = 0
    map.cy = 0
    const segment = {
      start: 0,
      end: 1,
      inner: 100,
      outer: 200,
      depth: 0,
      hue: 25,
      node: node("folder", 10),
      path: "/folder",
      opacity: 1,
      hover: 0,
    } as Sunburst["segments"][number]

    map._drawSegment(segment)
    segment.hover = 1
    map._drawSegment(segment)

    expect(radii).toEqual([200, 100, 200, 100])
    expect(fills[1]).toBe(fills[0])
    expect(fills[2]).toBe("oklch(1 0 0 / 0.11)")
    expect(strokes).toBe(0)
  })
})

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
      255, 25, 150, 285, 55, 255,
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
  it("keeps every directory and file depth inside sRGB", () => {
    for (let index = 0; index < 10; index++) {
      for (let depth = 0; depth < 6; depth++) {
        for (const directory of [true, false]) {
          const css = primarySegmentColor(index, 1, directory, depth)
          for (const channel of oklchToLinearSrgb(css, false)) {
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
      for (const color of [
        ...colors,
        ...[0, 1, 2].map((depth) => storageSummaryColor(index, depth, "tile")),
      ])
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

  it("keeps branch hues stable and gives files and summaries softer tints", () => {
    for (let index = 0; index < 10; index++) {
      const branchHue = primaryHueForIndex(index)
      for (let depth = 0; depth < 9; depth++) {
        const folder = storageMapColor(index, depth)
        const file = storageMapColor(index, depth, false)
        const summary = storageSummaryColor(index, depth, "map")
        expect(folder.endsWith(` ${branchHue})`)).toBe(true)
        expect(file.endsWith(` ${branchHue})`)).toBe(true)
        expect(summary.endsWith(` ${branchHue})`)).toBe(true)
        const chroma = (color: string) =>
          Number(color.match(/oklch\([\d.]+ ([\d.]+)/)?.[1])
        expect(chroma(file)).toBeGreaterThan(0)
        expect(chroma(file)).toBeLessThan(chroma(folder))
        expect(chroma(summary)).toBeGreaterThan(0)
        expect(chroma(summary)).toBeLessThan(chroma(folder))
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
    expect(sunburstTransitionDuration("drill", false)).toBe(360)
    expect(sunburstTransitionDuration("up", false)).toBe(360)
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
      360
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
    expect(map.maxR).toBeCloseTo(map.canvas.height * 0.46)
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
      viewOrigins: new Map(),
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
  it("lets a distant clicked wedge approach before it opens across the wheel", () => {
    const deep = {
      ...node("deep", 60, [node("leaf", 60)]),
      path: "/root/a/b/deep",
    }
    const branch = { ...node("b", 60, [deep]), path: "/root/a/b" }
    const folder = { ...node("a", 60, [branch]), path: "/root/a" }
    const root = {
      ...node("root", 100, [folder, node("other", 40)]),
      path: "/root",
    }
    const map = engine(root)
    const clicked = map.segments.find((segment) => segment.path === deep.path)!
    expect(clicked.depth).toBeGreaterThanOrEqual(2)
    const initialSpan = clicked.end - clicked.start

    map.navigateTo(deep)
    const bridge = map.segments.find((segment) => segment.path === deep.path)!
    map._tick(map.animStart + 80)
    const radialProgress =
      (bridge.inner - bridge.fromInner) / (bridge.toInner - bridge.fromInner)
    expect(radialProgress).toBeGreaterThan(0.4)
    expect(bridge.end - bridge.start).toBeCloseTo(initialSpan)
    map._tick(map.animStart + 120)
    expect(
      (bridge.inner - bridge.fromInner) / (bridge.toInner - bridge.fromInner)
    ).toBeGreaterThan(0.9)
    expect(bridge.end - bridge.start).toBeCloseTo(initialSpan)
    map._tick(map.animStart + 180)
    expect(bridge.end - bridge.start).toBeGreaterThan(initialSpan)
    map._tick(map.animStart + map.activeAnimMs)
    expect(bridge.end - bridge.start).toBeCloseTo(bridge.toEnd - bridge.toStart)
  })
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
  it("re-spreads the spectrum across the viewport and restores it on the way back", () => {
    const children = ["a", "b", "c", "d"].map((name) => ({
      ...node(name, 10),
      path: `/branch/${name}`,
    }))
    const selected = node("branch", 40, children)
    const root = node("root", 400, [node("large", 360), selected])
    const map = engine(root)
    const hues = () =>
      children.map(
        (child) =>
          map.segments.find((segment) => segment.path === child.path)!.toTone!.h
      )
    const before = hues()
    const spread = (values: number[]) =>
      Math.max(...values) - Math.min(...values)
    map.navigateTo(selected)
    // A drilled-in folder gets the whole wheel, so its children stay distinct.
    expect(spread(hues())).toBeGreaterThan(spread(before) * 4)
    map.navigateTo(root)
    expect(hues()).toEqual(before)
  })
  const branch = () =>
    node("branch", 10, [node("inside", 10, [node("deep", 10)])])
  it("anchors a drilled folder's first edge and restores the parent orientation", () => {
    const selected = node("branch", 40, [
      { ...node("first", 30), path: "/branch/first" },
      { ...node("second", 10), path: "/branch/second" },
    ])
    const root = node("root", 100, [node("large", 60), selected])
    const map = engine(root)
    const focus = map.segments.find(
      (segment) => segment.path === selected.path
    )!
    const originalStart = focus.start
    const childStart = map.segments.find(
      (segment) => segment.path === "/branch/first"
    )!.start

    map.navigateTo(selected)
    const first = map.segments.find(
      (segment) => segment.path === "/branch/first"
    )!
    expect(first.fromStart).toBeCloseTo(childStart)
    expect(first.toStart).toBeCloseTo(originalStart)
    expect(map.viewOrigins.get(selected.path)).toBeCloseTo(originalStart)

    map._tick(map.animStart + 361)
    map.navigateTo(root)
    const closing = map.segments.find(
      (segment) => segment.path === selected.path
    )!
    expect(closing.fromEnd - closing.fromStart).toBeCloseTo(Math.PI * 2)
    expect(closing.fromOpacity).toBe(1)
    expect(closing.toStart).toBeCloseTo(originalStart)
    expect(map.segments[0]).toBe(closing)
    map._tick(map.animStart + 150)
    expect(closing.end - closing.start).toBeLessThan(Math.PI * 2)
    expect(closing.end - closing.start).toBeGreaterThan(
      closing.toEnd - closing.toStart
    )
  })
  it("starts the navigation clock on the first paint after a busy view update", () => {
    const selected = branch()
    const map = engine(node("root", 100, [node("large", 90), selected]))
    map.navigateTo(selected)
    const source = map.segments.find((segment) => segment.path === "/inside")!
    const initialOpacity = source.opacity
    const firstPaintAt = map.animStart + 500
    Object.assign(map, { _draw: () => {}, _needsFrame: () => false })

    map["_frame"](firstPaintAt)

    expect(map.animStart).toBe(firstPaintAt)
    expect(map.animT).toBe(0)
    expect(source.opacity).toBe(initialOpacity)
    expect(map.animating).toBe(true)
  })
  it("keeps the clicked folder visible as it expands into the new center ring", () => {
    const selected = branch()
    const map = engine(node("root", 100, [node("large", 90), selected]))
    const oldWedge = map.segments.find(
      (segment) => segment.path === selected.path
    )!
    const oldSpan = oldWedge.end - oldWedge.start

    map.navigateTo(selected)
    const bridge = map.segments.find(
      (segment) => segment.path === selected.path
    )!
    expect(bridge.isDrillBridge).toBe(true)
    expect(bridge.toEnd - bridge.toStart).toBeCloseTo(Math.PI * 2)
    expect(bridge.toInner).toBeCloseTo(map._radiiForDepth(0).inner)
    expect(bridge.toOuter).toBeCloseTo(map._radiiForDepth(0).outer)
    expect(map.segments.at(-1)).toBe(bridge)

    map._tick(map.animStart + 120)
    expect(bridge.end - bridge.start).toBeGreaterThan(oldSpan)
    expect(bridge.opacity).toBe(1)
    map._tick(map.animStart + 361)
    expect(map.segments.some((segment) => segment.isDrillBridge)).toBe(false)
  })
  it("navigates from an old collapsed wedge when focused scanning replaces the tree", () => {
    const selected = node("branch", 10)
    const root = node("root", 100, [node("large", 90), selected])
    const map = engine(root)
    const expanded = node("branch", 10, [node("inside", 10)])
    const nextRoot = node("root", 100, [node("large", 90), expanded])

    map.reconcileAndNavigate(nextRoot, expanded)

    expect(map.root).toBe(nextRoot)
    expect(map.viewNode).toBe(expanded)
    expect(
      map.segments.find((segment) => segment.path === selected.path)
        ?.isDrillBridge
    ).toBe(true)
  })
  it("folds outgoing deep arcs into the closing folder instead of the outer rim", () => {
    const selected = branch()
    const root = node("root", 100, [node("large", 90), selected])
    const map = engine(root)
    map.options.rings = 2
    map.navigateTo(selected)
    map._tick(map.animStart + 361)

    map.navigateTo(root)
    const closing = map.segments.find(
      (segment) => segment.path === selected.path && segment.toOpacity > 0
    )!
    const outgoing = map.segments.find((segment) => segment.path === "/deep")!
    expect(outgoing.toOpacity).toBe(0)
    expect(outgoing.toInner).toBeCloseTo(closing.toInner)
    expect(outgoing.toOuter).toBeCloseTo(closing.toOuter)
    expect(outgoing.toStart).toBeGreaterThanOrEqual(closing.toStart)
    expect(outgoing.toEnd).toBeLessThanOrEqual(closing.toEnd)
  })
  it("keeps fading detail outside the parent ring while returning", () => {
    const selected = branch()
    const map = engine(node("root", 100, [node("large", 90), selected]))
    map.options.rings = 2
    map.navigateTo(selected)
    map._tick(map.animStart + map.activeAnimMs + 1)
    map.navigateTo(map.root!)

    const closing = map.segments.find(
      (segment) => segment.path === selected.path
    )!
    const outgoing = map.segments.find((segment) => segment.path === "/deep")!
    for (const ms of [20, 50, 80, 110, 140]) {
      map._tick(map.animStart + ms)
      if (outgoing.opacity > 0.02) {
        expect(outgoing.inner).toBeGreaterThanOrEqual(closing.outer - 1e-8)
      }
    }
  })
  it("opens parent siblings from the moving edges of the closing wheel", () => {
    const selected = node("branch", 40, [
      { ...node("inside", 40), path: "/branch/inside" },
    ])
    const root = node("root", 100, [
      node("before", 50),
      selected,
      node("after", 10),
    ])
    const map = engine(root)
    map.navigateTo(selected)
    map._tick(map.animStart + 361)

    map.navigateTo(root)
    const closing = map.segments.find(
      (segment) => segment.path === selected.path && segment.toOpacity > 0
    )!
    const before = map.segments.find((segment) => segment.path === "/before")!
    const after = map.segments.find((segment) => segment.path === "/after")!
    expect(before.fromStart).toBeCloseTo(closing.fromStart)
    expect(before.fromEnd).toBeCloseTo(closing.fromStart)
    expect(after.fromStart).toBeCloseTo(closing.fromEnd)
    expect(after.fromEnd).toBeCloseTo(closing.fromEnd)
    map._tick(map.animStart + 150)
    expect(before.end - before.start).toBeGreaterThan(0)
    expect(after.end - after.start).toBeGreaterThan(0)
  })
  it("keeps returning siblings outside the closing wedge throughout back navigation", () => {
    const selected = node("branch", 40, [
      { ...node("inside", 40), path: "/branch/inside" },
    ])
    const root = node("root", 100, [
      node("before", 40),
      selected,
      node("after", 20),
    ])
    const map = engine(root)
    map.navigateTo(selected)
    map._tick(map.animStart + map.activeAnimMs + 1)
    map.navigateTo(root)

    const closing = map.segments.find(
      (segment) => segment.path === selected.path
    )!
    const before = map.segments.find((segment) => segment.path === "/before")!
    const after = map.segments.find((segment) => segment.path === "/after")!
    for (const ms of [60, 120, 180, 240, 300]) {
      map._tick(map.animStart + ms)
      expect(before.end).toBeLessThanOrEqual(closing.start + 1e-8)
      expect(after.start).toBeGreaterThanOrEqual(closing.end - 1e-8)
    }
  })
  it("remembers skipped parent angles when drilling directly into a deep ring", () => {
    const deep = { ...node("deep", 10), path: "/branch/inside/deep" }
    const inside = {
      ...node("inside", 20, [deep]),
      path: "/branch/inside",
    }
    const branch = node("branch", 40, [inside])
    const root = node("root", 100, [node("before", 60), branch])
    const map = engine(root)
    const parentStart = map.segments.find(
      (segment) => segment.path === inside.path
    )!.start

    map.navigateTo(deep)
    expect(map.viewOrigins.get(inside.path)).toBeCloseTo(parentStart)
    map._tick(map.animStart + 361)
    map.navigateTo(inside)
    const child = map.segments.find(
      (segment) => segment.path === deep.path && segment.toOpacity > 0
    )!
    expect(child.toStart).toBeCloseTo(parentStart)
  })
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
