import { describe, expect, it } from "bun:test"
import { clearReviewForRootScan } from "./scan-lifecycle"

describe("root scan review lifecycle", () => {
  it("clears a deep review basket synchronously before a manual scan promise settles", async () => {
    let collection = ["/repo/deep/node_modules"]
    let dragNode: string | null = "/repo/deep/node_modules"
    let dropActive = true
    let reviewClosed = false
    let settle!: () => void
    const nativeScan = new Promise<void>((resolve) => (settle = resolve))

    function startManualRootScan() {
      clearReviewForRootScan<string>({
        setCollection: (items) => (collection = items),
        setDragNode: (node) => (dragNode = node),
        setDropActive: (active) => (dropActive = active),
        closeReview: () => (reviewClosed = true),
      })
      return nativeScan
    }

    const pending = startManualRootScan()

    expect(collection).toEqual([])
    expect(dragNode).toBeNull()
    expect(dropActive).toBe(false)
    expect(reviewClosed).toBe(true)

    settle()
    await pending
  })
})
