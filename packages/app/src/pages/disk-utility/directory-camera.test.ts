import { expect, test } from "bun:test"
import { focusCamera, inverseCamera } from "./directory-camera"
test("centers the clicked tile and fills the viewport with uniform scale", () => {
  const view = { x: 100, y: 50, width: 800, height: 600 }
  const tile = { x: 200, y: 100, width: 200, height: 100 }
  const camera = focusCamera(view, tile)
  expect(camera.scale).toBe(6)
  expect((tile.x - view.x + tile.width / 2) * camera.scale + camera.x).toBe(400)
  expect((tile.y - view.y + tile.height / 2) * camera.scale + camera.y).toBe(
    300
  )
  const inverse = inverseCamera(camera)
  expect(inverse.scale * camera.scale).toBe(1)
  expect(camera.x * inverse.scale + inverse.x).toBeCloseTo(0)
})
test("guards empty tile geometry", () => {
  const camera = focusCamera(
    { x: 0, y: 0, width: 800, height: 600 },
    { x: 0, y: 0, width: 0, height: 0 }
  )
  expect(Number.isFinite(camera.scale)).toBe(true)
})
