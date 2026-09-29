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

  it("keeps deep descendants in their top-level folder's color family", () => {
    const deep = folder("/Applications/Utilities/Tool", 20)
    const utilities = folder("/Applications/Utilities", 20, [deep])
    const applications = folder("/Applications", 40, [
      utilities,
      folder("/Applications/Other", 20),
    ])
    const documents = folder("/Documents", 60)
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
})
