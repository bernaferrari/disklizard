import { describe, expect, it } from "bun:test"
import { mergeScanDiscoveries, scanDiscoveryArcs, type ScanDiscovery } from "./scan-progress"

const discovery = (name: string, size: number): ScanDiscovery => ({
  name,
  path: `/scan/${name}`,
  size,
  isDir: true,
})

describe("live scan landscape", () => {
  it("keeps the largest completed branches sorted and deduplicated", () => {
    let items = [discovery("cache", 20), discovery("source", 40)]
    items = mergeScanDiscoveries(items, discovery("target", 80), 2)
    items = mergeScanDiscoveries(items, discovery("target", 120), 2)

    expect(items.map((item) => [item.name, item.size])).toEqual([
      ["target", 120],
      ["source", 40],
    ])
  })

  it("maps known branch proportions around one orbit without claiming scan completion", () => {
    const arcs = scanDiscoveryArcs([discovery("target", 75), discovery("source", 25)])

    expect(arcs[0]).toMatchObject({ name: "target", start: 0 })
    expect(arcs[0].length).toBeCloseTo(0.738)
    expect(arcs[1].start).toBeCloseTo(0.75)
    expect(arcs[1].length).toBeCloseTo(0.238)
  })

  it("ignores zero-byte branches", () => {
    expect(scanDiscoveryArcs([discovery("empty", 0)])).toEqual([])
  })
})
