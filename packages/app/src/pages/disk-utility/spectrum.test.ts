import { describe, expect, it } from "bun:test"
import { aggregateTone, createSpectrum, spectrumTone } from "./spectrum"
import type { DiskScanNode } from "./types"

function folder(
  path: string,
  size: number,
  children: DiskScanNode[] = []
): DiskScanNode {
  return {
    name: path.split("/").at(-1) ?? path,
    path,
    size,
    isDir: true,
    children,
    ext: "",
  }
}

function hueDistance(a: number, b: number) {
  return Math.abs(((a - b + 540) % 360) - 180)
}

describe("shared folder spectrum", () => {
  it("keeps smaller items in the same hue family as their folder", () => {
    const branch = spectrumTone(220, 2, true)
    const summary = aggregateTone(2, 220)
    expect(summary.h).toBe(branch.h)
    expect(summary.C).toBeGreaterThan(branch.C * 0.6)
    expect(summary.C).toBeLessThan(branch.C)
    expect(summary.L).toBeGreaterThan(branch.L)
  })

  it("keeps a small branch's descendants in its color family", () => {
    const deep = folder("/Applications/Utilities/Tool", 4)
    const utilities = folder("/Applications/Utilities", 4, [deep])
    const applications = folder("/Applications", 8, [
      utilities,
      folder("/Applications/Other", 4),
    ])
    const documents = folder("/Documents", 92)
    const spectrum = createSpectrum(folder("/", 100, [documents, applications]))
    const branchHue = spectrum.tone(applications)!.h

    expect(
      hueDistance(spectrum.tone(utilities)!.h, branchHue)
    ).toBeLessThanOrEqual(20)
    expect(hueDistance(spectrum.tone(deep)!.h, branchHue)).toBeLessThanOrEqual(
      20
    )
    expect(hueDistance(spectrum.tone(documents)!.h, branchHue)).toBeGreaterThan(
      20
    )
  })

  it("fans a dominant branch's children across a wide band", () => {
    const children = Array.from({ length: 6 }, (_, index) =>
      folder(`/Users/${index}`, 60 - index * 5)
    )
    const users = folder("/Users", 285, children)
    const spectrum = createSpectrum(
      folder("/", 300, [users, folder("/System", 15)])
    )
    const hues = children.map((child) => spectrum.tone(child)!.h)
    const spread = Math.max(
      ...hues.map((a) => Math.max(...hues.map((b) => hueDistance(a, b))))
    )
    expect(spread).toBeGreaterThan(120)
  })

  it("keeps neighbours on the ring distinct even with many siblings", () => {
    const children = Array.from({ length: 40 }, (_, index) =>
      folder(`/item-${String(index).padStart(2, "0")}`, 1_000 - index)
    )
    const spectrum = createSpectrum(folder("/", 40_000, children))
    const hues = children.map((child) => spectrum.tone(child)!.h)
    for (let index = 1; index < hues.length; index++)
      expect(hueDistance(hues[index], hues[index - 1])).toBeGreaterThan(30)
  })

  it("never gives two top-level siblings the same hue", () => {
    const names = ["Users", "System", "private", "Applications", "Library"]
    const children = names.map((name, index) => folder(`/${name}`, 50 - index))
    const spectrum = createSpectrum(folder("/", 240, children))
    const hues = children.map((child) => spectrum.tone(child)!.h)
    expect(new Set(hues).size).toBe(names.length)
  })
})

it("keeps branch identity when a neighbor grows past it", () => {
  const a = folder("/A", 60)
  const before = createSpectrum(folder("/", 100, [a, folder("/B", 40)]))
  const after = createSpectrum(folder("/", 150, [folder("/B", 90), a]))
  expect(after.tone(a)?.h).toBe(before.tone(a)?.h)
})
