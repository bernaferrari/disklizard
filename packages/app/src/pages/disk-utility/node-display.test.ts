import { describe, expect, it } from "bun:test"
import { diskNodeDisplayName } from "./node-display"

describe("disk node display names", () => {
  it("uses aggregate metadata with correct singular and plural copy", () => {
    expect(diskNodeDisplayName({ name: "untrusted", isOther: true, otherCount: 1 })).toBe("1 smaller item")
    expect(diskNodeDisplayName({ name: "untrusted", isOther: true, otherCount: 18 })).toBe("18 smaller items")
  })

  it("does not parse legacy scanner copy and preserves real and hidden names", () => {
    expect(diskNodeDisplayName({ name: "Other (999 items)", isOther: true })).toBe("Other items")
    expect(diskNodeDisplayName({ name: "Hidden space", isOther: true, isHidden: true })).toBe("Hidden space")
    expect(diskNodeDisplayName({ name: "Photos", isOther: false })).toBe("Photos")
  })
})
