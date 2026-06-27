import { describe, it, expect } from "bun:test"
import { layoutTreemap } from "./treemap"
import type { DiskScanNode } from "@/context/platform"

const mk = (name: string, size: number): DiskScanNode => ({ name, path: `/${name}`, size, isDir: true, children: [], ext: "" })

const overlap = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

describe("layoutTreemap", () => {
  it("returns no rects for empty input", () => {
    expect(layoutTreemap([])).toEqual([])
  })

  it("a single child fills the whole box", () => {
    const r = layoutTreemap([mk("only", 100)])
    expect(r).toHaveLength(1)
    expect(r[0].x).toBe(0)
    expect(r[0].y).toBe(0)
    expect(r[0].w).toBeCloseTo(1)
    expect(r[0].h).toBeCloseTo(1)
  })

  it("tiles the box without overlaps and fills it (area ~1)", () => {
    const kids = [mk("a", 600), mk("b", 300), mk("c", 70), mk("d", 30)]
    const rects = layoutTreemap(kids)
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        expect(overlap(rects[i], rects[j])).toBe(false)
      }
    }
    const covered = rects.reduce((s, r) => s + r.w * r.h, 0)
    expect(covered).toBeCloseTo(1, 1)
  })

  it("skips zero/negative-size children", () => {
    const rects = layoutTreemap([mk("big", 100), mk("zero", 0), mk("neg", -5)])
    expect(rects).toHaveLength(1)
    expect(rects[0].node.name).toBe("big")
  })

  it("keeps aspect ratios reasonable (max <= ~4 for balanced input)", () => {
    const kids = Array.from({ length: 8 }, (_, i) => mk(`n${i}`, 100 - i * 5))
    const rects = layoutTreemap(kids)
    const maxAspect = Math.max(...rects.map((r) => Math.max(r.w / r.h, r.h / r.w)))
    expect(maxAspect).toBeLessThan(4)
  })

  it("indexes by sorted (size desc) order for color sync", () => {
    const rects = layoutTreemap([mk("small", 10), mk("huge", 1000), mk("mid", 100)])
    expect(rects.map((r) => r.index)).toEqual([0, 1, 2])
    expect(rects[0].node.name).toBe("huge")
  })
})
