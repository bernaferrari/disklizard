import { describe, expect, it } from "bun:test"
import { isReviewNavigationKey, reviewNavigationTarget } from "./review-navigation"

describe("virtual review list navigation", () => {
  it("moves through every item without wrapping at either edge", () => {
    expect(reviewNavigationTarget({ currentIndex: -1, key: "ArrowDown", length: 4, pageSize: 1 })).toBe(0)
    expect(reviewNavigationTarget({ currentIndex: 0, key: "ArrowUp", length: 4, pageSize: 1 })).toBe(0)
    expect(reviewNavigationTarget({ currentIndex: 3, key: "ArrowDown", length: 4, pageSize: 1 })).toBe(3)
    expect(reviewNavigationTarget({ currentIndex: 1, key: "Home", length: 4, pageSize: 1 })).toBe(0)
    expect(reviewNavigationTarget({ currentIndex: 1, key: "End", length: 4, pageSize: 1 })).toBe(3)
  })

  it("skips structural rows and keeps page navigation bounded", () => {
    const isItem = (index: number) => [1, 2, 4, 5].includes(index)
    const input = { length: 6, pageSize: 2, isFocusable: isItem }

    expect(reviewNavigationTarget({ ...input, currentIndex: -1, key: "ArrowDown" })).toBe(1)
    expect(reviewNavigationTarget({ ...input, currentIndex: -1, key: "ArrowUp" })).toBe(5)
    expect(reviewNavigationTarget({ ...input, currentIndex: 2, key: "ArrowDown" })).toBe(4)
    expect(reviewNavigationTarget({ ...input, currentIndex: 4, key: "ArrowUp" })).toBe(2)
    expect(reviewNavigationTarget({ ...input, currentIndex: 1, key: "PageDown" })).toBe(4)
    expect(reviewNavigationTarget({ ...input, currentIndex: 4, key: "PageUp" })).toBe(2)
  })

  it("returns no target when the review has no focusable items", () => {
    expect(
      reviewNavigationTarget({ currentIndex: 0, key: "ArrowDown", length: 3, pageSize: 1, isFocusable: () => false }),
    ).toBe(-1)
  })

  it("recognizes only the keys handled by the roving-focus list", () => {
    expect(isReviewNavigationKey("PageDown")).toBe(true)
    expect(isReviewNavigationKey("Enter")).toBe(false)
  })
})
