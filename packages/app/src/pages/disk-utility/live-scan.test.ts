import { describe, expect, test } from "bun:test"
import {
  mergeDiscovery,
  scanDiscoverySegments,
  type ScanDiscovery,
} from "./live-scan"

const folder = (name: string, size: number): ScanDiscovery => ({
  name,
  path: `/scan/${name}`,
  size,
  isDir: true,
})

describe("live scan discoveries", () => {
  test("a larger late discovery does not reorder or recolor existing arcs", () => {
    const first = folder("first", 10)
    const second = folder("second", 100)
    const before = scanDiscoverySegments([first], 0)
    const after = scanDiscoverySegments([first, second], 0)

    expect(after.map((part) => part.item.path)).toEqual([
      first.path,
      second.path,
    ])
    expect(after[0]?.color).toBe(before[0]?.color)
    expect(after.at(-1)?.end).toBeCloseTo(0.8)
  })

  test("a known volume capacity keeps completed arcs proportional", () => {
    const parts = scanDiscoverySegments([folder("a", 10)], 100)
    expect(parts[0]?.end).toBeCloseTo(0.1)
  })

  test("late large folders replace tiny early discoveries without recoloring survivors", () => {
    let discoveries: readonly ScanDiscovery[] | undefined
    for (let index = 0; index < 48; index++) {
      discoveries = mergeDiscovery(discoveries, folder(`small-${index}`, 1))
    }
    const retainedPath = discoveries?.[20]?.path ?? ""
    expect(retainedPath).not.toBe("")
    const color = scanDiscoverySegments(discoveries ?? [], 0).find(
      (part) => part.item.path === retainedPath
    )?.color

    discoveries = mergeDiscovery(discoveries, folder("large", 1_000))
    expect(discoveries).toHaveLength(48)
    expect(discoveries?.at(-1)?.name).toBe("large")
    expect(
      scanDiscoverySegments(discoveries ?? [], 0).find(
        (part) => part.item.path === retainedPath
      )?.color
    ).toBe(color)
  })
})
