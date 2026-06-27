import { describe, it, expect } from "bun:test"
import { formatBytes, shortBytes, formatPct, truncatePath } from "./format"

describe("formatBytes", () => {
  it("zero", () => {
    expect(formatBytes(0)).toBe("0 B")
  })
  it("sub-10 values get two decimals", () => {
    expect(formatBytes(1024)).toBe("1.00 KB")
  })
  it("10–100 values get one decimal", () => {
    expect(formatBytes(50 * 1024)).toBe("50.0 KB")
  })
  it(">=100 values are rounded", () => {
    expect(formatBytes(256 * 1024)).toBe("256 KB")
  })
  it("crosses unit boundaries", () => {
    expect(formatBytes(5 * 1024 ** 3)).toBe("5.00 GB")
  })
})

describe("shortBytes", () => {
  it("compact form", () => {
    expect(shortBytes(2.4 * 1024 ** 3)).toBe("2.4 GB")
    expect(shortBytes(890 * 1024 ** 2)).toBe("890 MB")
  })
})

describe("formatPct", () => {
  it("zero / no whole", () => {
    expect(formatPct(0, 0)).toBe("0%")
    expect(formatPct(10, 0)).toBe("0%")
  })
  it("tiny parts are <0.1%", () => {
    expect(formatPct(1, 10000)).toBe("<0.1%")
  })
  it("small parts keep one decimal", () => {
    expect(formatPct(5, 100)).toBe("5.0%")
  })
  it("larger parts are rounded", () => {
    expect(formatPct(45, 100)).toBe("45%")
  })
})

describe("truncatePath", () => {
  it("leaves short strings alone", () => {
    expect(truncatePath("/a/b", 20)).toBe("/a/b")
  })
  it("prefixes long strings with ellipsis", () => {
    const s = "x".repeat(60)
    const out = truncatePath(s, 20)
    expect(out.startsWith("…")).toBe(true)
    expect(out.length).toBe(20)
  })
})
