import { describe, expect, it } from "bun:test"
import type { DiskScanNode } from "@/context/platform"
import { centerOverlayBehavior } from "./DiskUtilityEmptyStates"

function directory(name: string): DiskScanNode {
  return { name, path: `/workspace/${name}`, size: 1, isDir: true, children: [], ext: "" }
}

describe("centerOverlayBehavior", () => {
  it("does not advertise Open or Enter for a deep inventory-only result", () => {
    const deepArtifact = { ...directory("node_modules"), inventoryOnly: true } as DiskScanNode & { inventoryOnly: true }
    expect(centerOverlayBehavior(deepArtifact, true, true)).toEqual({
      canOpen: false,
      inventoryOnly: true,
      reviewOnlyCopy: "Deep inventory result · review it from the results list. It can’t be opened in the map.",
    })
  })

  it("keeps the open affordance for a materialized directory", () => {
    expect(centerOverlayBehavior(directory("src"), true, false)).toEqual({ canOpen: true, inventoryOnly: false })
    expect(centerOverlayBehavior({ ...directory("package.json"), isDir: false }, true, false)).toEqual({
      canOpen: false,
      inventoryOnly: false,
    })
  })
})
