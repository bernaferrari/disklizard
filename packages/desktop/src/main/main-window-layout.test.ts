import { describe, expect, test } from "bun:test"
import { MAIN_WINDOW_MINIMUM_HEIGHT, MAIN_WINDOW_MINIMUM_WIDTH, mainWindowMinimumSize } from "./main-window-layout"

describe("standalone window layout", () => {
  test("keeps the dense disk workspace above a usable desktop size", () => {
    expect(mainWindowMinimumSize()).toEqual({
      minWidth: MAIN_WINDOW_MINIMUM_WIDTH,
      minHeight: MAIN_WINDOW_MINIMUM_HEIGHT,
    })
    expect(MAIN_WINDOW_MINIMUM_WIDTH).toBeGreaterThanOrEqual(900)
    expect(MAIN_WINDOW_MINIMUM_HEIGHT).toBeGreaterThanOrEqual(640)
  })
})
