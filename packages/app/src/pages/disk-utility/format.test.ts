import { afterEach, beforeEach, describe, it, expect } from "bun:test"
import {
  daysSinceChanged,
  byteUnitBaseForOs,
  formatBytes,
  formatLastChanged,
  setByteUnitBase,
  isDormant,
  shortBytes,
  formatPct,
  truncatePath,
} from "./format"

describe("byte units follow the platform file manager", () => {
  it("counts decimal units on macOS and Linux, binary on Windows", () => {
    expect(byteUnitBaseForOs("macos")).toBe(1000)
    expect(byteUnitBaseForOs("linux")).toBe(1000)
    expect(byteUnitBaseForOs("windows")).toBe(1024)
  })
  it("shows a 1 TB disk as 1 TB in decimal units", () => {
    setByteUnitBase(1000)
    expect(formatBytes(1_000_000_000_000)).toBe("1.00 TB")
    expect(shortBytes(994_662_584_320)).toBe("995 GB")
  })
})

describe("formatBytes", () => {
  beforeEach(() => setByteUnitBase(1024))
  afterEach(() => setByteUnitBase(1000))
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
  beforeEach(() => setByteUnitBase(1024))
  afterEach(() => setByteUnitBase(1000))
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

describe("developer artifact age", () => {
  const now = Date.UTC(2026, 7, 9, 12)
  const daysAgo = (days: number) => now - days * 24 * 60 * 60 * 1_000

  it("formats age at useful human-scale boundaries", () => {
    expect(formatLastChanged(undefined, now)).toBe("Change date unavailable")
    expect(formatLastChanged(daysAgo(0), now)).toBe("Changed today")
    expect(formatLastChanged(daysAgo(1), now)).toBe("Changed yesterday")
    expect(formatLastChanged(daysAgo(8), now)).toBe("Changed 8d ago")
    expect(formatLastChanged(daysAgo(35), now)).toBe("Changed 5w ago")
    expect(formatLastChanged(daysAgo(120), now)).toBe("Changed 4mo ago")
    expect(formatLastChanged(daysAgo(800), now)).toBe("Changed 2y ago")
  })

  it("treats unknown and future timestamps conservatively", () => {
    expect(daysSinceChanged(undefined, now)).toBeNull()
    expect(daysSinceChanged(now + 1_000, now)).toBe(0)
    expect(isDormant(undefined, now)).toBe(false)
  })

  it("marks developer data dormant after ninety days", () => {
    expect(isDormant(daysAgo(89), now)).toBe(false)
    expect(isDormant(daysAgo(90), now)).toBe(true)
  })
})
