import { describe, expect, it } from "bun:test"
import { clampedListIndex, inclusiveIndexRange, pagedListIndex, selectionAnchorIndex, wrappedListIndex } from "./list-navigation"

describe("disk index keyboard navigation", () => {
  it("wraps single-item focus without producing an invalid virtual-list index", () => {
    expect(wrappedListIndex(0, -1, 1)).toBe(0)
    expect(wrappedListIndex(4, 1, 5)).toBe(0)
    expect(wrappedListIndex(0, -1, 5)).toBe(4)
    expect(wrappedListIndex(0, 1, 0)).toBe(-1)
  })

  it("bounds Home, End, and page movement at visible-list edges", () => {
    expect(clampedListIndex(-4, 5)).toBe(0)
    expect(clampedListIndex(20, 5)).toBe(4)
    expect(clampedListIndex(0, 0)).toBe(-1)
    expect(pagedListIndex(1, 1, 3, 5)).toBe(4)
    expect(pagedListIndex(3, -1, 9, 5)).toBe(0)
    expect(pagedListIndex(0, 1, 4, 0)).toBe(-1)
  })

  it("starts a new Shift range from the pre-move focus and retains an existing anchor", () => {
    expect(selectionAnchorIndex(undefined, 2, 6)).toBe(2)
    expect(selectionAnchorIndex(1, 4, 6)).toBe(1)
    expect(selectionAnchorIndex(30, 4, 6)).toBe(5)
  })

  it("keeps Shift selection inclusive in both directions", () => {
    expect(inclusiveIndexRange(2, 5, 9)).toEqual([2, 3, 4, 5])
    expect(inclusiveIndexRange(5, 2, 9)).toEqual([2, 3, 4, 5])
    expect(inclusiveIndexRange(2, 20, 4)).toEqual([2, 3])
  })
})
