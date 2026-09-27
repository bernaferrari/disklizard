import { describe, expect, it } from "bun:test"
import type { DiskScanNode } from "./types"
import { storageAccountingFacts } from "./StorageAccounting"

const node = (overrides: Partial<DiskScanNode> = {}): DiskScanNode => ({
  name: "artifact.bin",
  path: "/workspace/artifact.bin",
  size: 1_024,
  isDir: false,
  children: [],
  ext: "bin",
  ...overrides,
})

describe("storage accounting facts", () => {
  it("explains apparent size and secondary hard links", () => {
    expect(
      storageAccountingFacts(
        node({ logicalSize: 4_096, hardLink: "secondary" })
      ).map((fact) => fact.label)
    ).toEqual(["File size 4.00 KB", "Shared hard link"])
  })

  it("surfaces APFS clone evidence without treating unavailable evidence as a claim", () => {
    expect(
      storageAccountingFacts(
        node({ clone: { state: "unavailable", reason: "platform" } })
      )
    ).toEqual([])
    expect(
      storageAccountingFacts(
        node({
          clone: {
            state: "shares-all-blocks",
            cloneId: "clone-1",
            reportedFullCloneCount: 2,
          },
        })
      )
    ).toEqual([expect.objectContaining({ label: "APFS clone shares blocks" })])
  })

  it("distinguishes a proven complete clone group from uncharged clone evidence", () => {
    expect(
      storageAccountingFacts(
        node({
          size: 0,
          logicalSize: 1_024,
          clone: {
            state: "shares-all-blocks",
            cloneId: "clone-1",
            reportedFullCloneCount: 2,
          },
          cloneAccounting: "secondary",
        })
      ).map((fact) => fact.label)
    ).toEqual(["File size 1.00 KB", "Clone allocation counted once"])
  })
})
