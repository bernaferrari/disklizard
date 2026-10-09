import { expect, test } from "bun:test"
import { createPinchAccumulator, isZoomWheel } from "./pinch-navigation"

test("a decisive pinch commits exactly one level, then waits for the camera", () => {
  const pinch = createPinchAccumulator(60, 500)
  expect(pinch.push(-20, 0)).toBeUndefined()
  expect(pinch.push(-20, 10)).toBeUndefined()
  expect(pinch.push(-25, 20)).toBe("in")
  // Still moving: a long gesture must not skip through several levels.
  expect(pinch.push(-200, 100)).toBeUndefined()
  expect(pinch.push(-70, 600)).toBe("in")
})

test("pinching out zooms back to the parent", () => {
  const pinch = createPinchAccumulator(60, 500)
  expect(pinch.push(30, 0)).toBeUndefined()
  expect(pinch.push(40, 16)).toBe("out")
})

test("reversing mid-gesture starts a new intent instead of cancelling out", () => {
  const pinch = createPinchAccumulator(60, 500)
  expect(pinch.push(-50, 0)).toBeUndefined()
  expect(pinch.push(30, 16)).toBeUndefined()
  expect(pinch.push(35, 32)).toBe("out")
})

test("only pinch and modifier scrolls count as zoom", () => {
  expect(isZoomWheel({ ctrlKey: true, metaKey: false })).toBe(true)
  expect(isZoomWheel({ ctrlKey: false, metaKey: true })).toBe(true)
  expect(isZoomWheel({ ctrlKey: false, metaKey: false })).toBe(false)
})
