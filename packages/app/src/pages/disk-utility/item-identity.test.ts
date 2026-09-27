import { describe, expect, it } from "bun:test"
import { distinguishingPathLabels, itemIdentity } from "./item-identity"
import type { DiskScanNode } from "./types"

describe("cleanup item identity", () => {
  it("retains the project and artifact in review", () => {
    const node: DiskScanNode = {
      name: "target",
      path: "/work/payments/target",
      size: 1,
      isDir: true,
      children: [],
      ext: "",
    }
    expect(itemIdentity(node).reviewTitle).toBe("payments / target")
  })

  it("distinguishes identical project names from different locations", () => {
    const paths = [
      "/Users/bernardo/Work/payments/target",
      "/Volumes/Backup/payments/target",
    ]
    const labels = distinguishingPathLabels(paths)
    expect(labels.get(paths[0])).toContain("Work/payments/target")
    expect(labels.get(paths[1])).toContain("Backup/payments/target")
    expect(labels.get(paths[0])).not.toBe(labels.get(paths[1]))
  })
})
