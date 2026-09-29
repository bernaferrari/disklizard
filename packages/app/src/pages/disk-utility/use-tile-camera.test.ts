import { describe, expect, test } from "bun:test"
import type { CameraBox } from "./directory-camera"
import type { DiskScanNode } from "./types"
import { tileCameraAnchor, tileCameraZoomTransform } from "./use-tile-camera"

const node = (
  path: string,
  children: DiskScanNode[] = [],
  isOther = false
): DiskScanNode => ({
  name: path.split(/[\\/]/).at(-1) ?? path,
  path,
  size: 1,
  isDir: true,
  isOther,
  children,
  ext: "",
})

const box = (x: number): CameraBox => ({
  x,
  y: 0,
  width: 100,
  height: 100,
})

describe("tile camera navigation anchor", () => {
  test("returns to the visible group when an opened child is collapsed into smaller items", () => {
    const tiles = new Map([
      ["/root/large", { node: node("/root/large"), box: box(0) }],
      [
        "/root/@other",
        {
          node: node("/root/@other", [node("/root/electron")], true),
          box: box(120),
        },
      ],
    ] as const)

    expect(tileCameraAnchor("/root/electron", tiles)).toEqual(box(120))
    expect(tileCameraAnchor("/root/large", tiles)).toEqual(box(0))
    expect(tileCameraAnchor("/root/missing", tiles)).toBeUndefined()
  })

  test("anchors a deep folder to its nearest visible ancestor across Windows paths", () => {
    const tiles = new Map([
      ["C:\\root", { node: node("C:\\root"), box: box(0) }],
      ["C:\\root\\nested", { node: node("C:\\root\\nested"), box: box(120) }],
    ] as const)

    expect(tileCameraAnchor("C:\\root\\nested\\deep", tiles)).toEqual(box(120))
  })
})

test("tile navigation zooms uniformly even from a wide sibling control", () => {
  const frame = { x: 0, y: 0, width: 800, height: 600 }
  const sibling = { x: 200, y: 0, width: 120, height: 28 }
  const transform = tileCameraZoomTransform(sibling, frame, frame)
  const pose = transform.match(
    /^translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)$/
  )
  expect(pose).not.toBeNull()
  const [, x, y, scale] = pose!
  expect(Number(x) + (frame.width / 2) * Number(scale)).toBeCloseTo(
    sibling.x + sibling.width / 2
  )
  expect(Number(y) + (frame.height / 2) * Number(scale)).toBeCloseTo(
    sibling.y + sibling.height / 2
  )
})
