import { expect, test } from "bun:test"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { Treemap } from "./TreemapPanel"
import { ViewSwitch } from "./ExplorerChrome"
import type { DiskScanNode } from "./types"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

test("explore offers only map and tiles", async () => {
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () =>
      root.render(<ViewSwitch value="grid" onChange={() => {}} />)
    )
    expect(
      [...host.querySelectorAll("button[aria-keyshortcuts]")].map((button) =>
        button.getAttribute("aria-keyshortcuts")
      )
    ).toEqual(["1", "2"])
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})

test("a remainder stays one readable block and reveals members without drilling", async () => {
  const previousBounds = HTMLElement.prototype.getBoundingClientRect
  HTMLElement.prototype.getBoundingClientRect = () =>
    ({ x: 0, y: 0, width: 800, height: 600 }) as DOMRect
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  const members: DiskScanNode[] = Array.from({ length: 120 }, (_, index) => ({
    name: `item-${index}`,
    path: `/root/item-${index}`,
    size: index === 0 ? 100_000 : 1_000,
    isDir: false,
    children: [],
    ext: "bin",
  }))
  const summary: DiskScanNode = {
    name: "",
    path: "disklizard:mosaic-more:/root/item-0",
    size: 219_000,
    isDir: true,
    isOther: true,
    otherCount: 120,
    children: members,
    ext: "",
  }
  let revealed: DiskScanNode | undefined
  let drilled = false
  try {
    await act(async () =>
      root.render(
        <Treemap
          rootPath="/root"
          colorForPath={() => "oklch(0.7 0.1 220)"}
          colorForNode={() => "oklch(0.7 0.1 340)"}
          children={[summary]}
          hoveredPath={null}
          onHover={() => {}}
          onSelect={() => {}}
          onDrill={() => {
            drilled = true
          }}
          onShowAll={(node) => {
            revealed = node
          }}
          canCollect={() => false}
          onCollectDragStart={() => {}}
        />
      )
    )
    const tile = host.querySelector<HTMLElement>(
      `[data-disk-tile-path="${summary.path}"]`
    )
    const previewPaths = tile?.querySelectorAll("svg path")
    expect(previewPaths).toHaveLength(0)
    expect(tile?.querySelector(".dl-treemap-text")?.textContent).toContain(
      "smaller items"
    )
    await act(async () => tile?.click())
    expect(revealed).toBe(summary)
    expect(drilled).toBe(false)
  } finally {
    await act(async () => root.unmount())
    host.remove()
    HTMLElement.prototype.getBoundingClientRect = previousBounds
  }
})

test("a compressed folder tile opens the first meaningful split", async () => {
  const previousBounds = HTMLElement.prototype.getBoundingClientRect
  HTMLElement.prototype.getBoundingClientRect = () =>
    ({ x: 0, y: 0, width: 800, height: 600 }) as DOMRect
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  const leaf: DiskScanNode = {
    name: "leaf",
    path: "/root/outer/inner/leaf",
    size: 100,
    isDir: false,
    children: [],
    ext: "txt",
  }
  const inner: DiskScanNode = {
    name: "inner",
    path: "/root/outer/inner",
    size: 100,
    isDir: true,
    children: [leaf],
    ext: "",
  }
  const outer: DiskScanNode = {
    name: "outer",
    path: "/root/outer",
    size: 100,
    isDir: true,
    children: [inner],
    ext: "",
  }
  let opened: string | undefined
  try {
    await act(async () =>
      root.render(
        <Treemap
          rootPath="/root"
          colorForPath={() => "oklch(0.7 0.1 200)"}
          colorForNode={() => "oklch(0.7 0.1 200)"}
          children={[outer]}
          hoveredPath={null}
          onHover={() => {}}
          onSelect={() => {}}
          onDrill={(node) => {
            opened = node.path
          }}
          onShowAll={() => {}}
          canCollect={() => false}
          onCollectDragStart={() => {}}
        />
      )
    )
    const tile = host.querySelector<HTMLElement>(
      '[data-disk-tile-path="/root/outer"]'
    )
    expect(tile?.textContent).toContain("outer / inner")
    await act(async () => {
      tile?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(opened).toBe(inner.path)
  } finally {
    await act(async () => root.unmount())
    host.remove()
    HTMLElement.prototype.getBoundingClientRect = previousBounds
  }
})

test("an opened tile keeps neighboring folders directly reachable", async () => {
  const previousBounds = HTMLElement.prototype.getBoundingClientRect
  const previousAnimate = HTMLElement.prototype.animate
  const animationTargets: HTMLElement[] = []
  const sceneOpacityAnimations: Keyframe[][] = []
  HTMLElement.prototype.getBoundingClientRect = () =>
    ({ x: 0, y: 0, width: 800, height: 600 }) as DOMRect
  HTMLElement.prototype.animate = function (...args) {
    animationTargets.push(this)
    if (this.hasAttribute("data-disk-tile-scene") && Array.isArray(args[0]))
      sceneOpacityAnimations.push(
        (args[0] as Keyframe[]).filter((frame) => frame.opacity !== undefined)
      )
    return previousAnimate.apply(this, args)
  }
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  const first: DiskScanNode = {
    name: "First",
    path: "/root/first",
    size: 60,
    isDir: true,
    children: [],
    ext: "",
  }
  const second: DiskScanNode = {
    name: "Second",
    path: "/root/second",
    size: 40,
    isDir: true,
    children: [],
    ext: "",
  }
  const parent: DiskScanNode = {
    name: "root",
    path: "/root",
    size: 100,
    isDir: true,
    children: [first, second],
    ext: "",
  }
  const leaf = (folder: DiskScanNode): DiskScanNode => ({
    name: "leaf",
    path: `${folder.path}/leaf`,
    size: folder.size,
    isDir: false,
    children: [],
    ext: "bin",
  })
  const firstLeaf = leaf(first)
  const secondLeaf = leaf(second)
  let opened: string | undefined
  let prepare: (path: string) => void = () => {}
  const renderAt = (path: string) =>
    root.render(
      <Treemap
        rootPath={path}
        parent={{ node: parent, onUp: () => {} }}
        onPrepareNavigation={(capture) => {
          prepare = capture ?? (() => {})
        }}
        colorForPath={() => "oklch(0.7 0.1 200)"}
        colorForNode={() => "oklch(0.7 0.1 200)"}
        children={[path === first.path ? firstLeaf : secondLeaf]}
        hoveredPath={null}
        onHover={() => {}}
        onSelect={() => {}}
        onDrill={(node) => {
          prepare(node.path)
          opened = node.path
        }}
        onShowAll={() => {}}
        canCollect={() => false}
        onCollectDragStart={() => {}}
      />
    )
  try {
    await act(async () => renderAt(first.path))
    const sibling = host.querySelector<HTMLElement>(
      '[data-disk-sibling-path="/root/second"]'
    )
    expect(sibling).not.toBeNull()
    await act(async () => {
      sibling?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(opened).toBe(second.path)
    await act(async () => renderAt(second.path))
    expect(
      host.querySelector(
        '[data-disk-tile-ghost] [data-disk-tile-path="/root/first/leaf"]'
      )
    ).not.toBeNull()
    expect(
      host.querySelector(
        '[data-disk-tile-scene] [data-disk-tile-path="/root/second/leaf"]'
      )
    ).not.toBeNull()
    expect(host.querySelectorAll("[data-disk-tile-ghost]")).toHaveLength(1)
    expect(
      sceneOpacityAnimations.some(
        (frames) => frames[0]?.opacity === 0 && frames[2]?.opacity === 1
      )
    ).toBe(true)
    expect(host.querySelector("[data-tile-scene-flight]")).not.toBeNull()
    const interruptedTile = host.querySelector<HTMLElement>(
      '[data-disk-tile-scene] [data-disk-tile-path="/root/second/leaf"]'
    )!
    interruptedTile.style.transform = "translate(13px, 8px)"
    prepare(first.path)
    await act(async () => renderAt(first.path))
    expect(host.querySelectorAll("[data-disk-tile-ghost]")).toHaveLength(1)
    expect(
      host.querySelector<HTMLElement>(
        '[data-disk-tile-ghost] [data-disk-tile-path="/root/second/leaf"]'
      )?.style.transform
    ).toBe("translate(13px, 8px)")
    expect(
      host.querySelector(
        '[data-disk-tile-ghost] [data-disk-tile-path="/root/second/leaf"]'
      )
    ).not.toBeNull()
    expect(
      host.querySelector(
        '[data-disk-tile-scene] [data-disk-tile-path="/root/first/leaf"]'
      )
    ).not.toBeNull()
    expect(
      animationTargets.some((target) =>
        target.hasAttribute("data-disk-tile-scene")
      )
    ).toBe(true)
    expect(
      animationTargets.some((target) => target.classList.contains("dl-treemap"))
    ).toBe(false)
  } finally {
    await act(async () => root.unmount())
    host.remove()
    HTMLElement.prototype.getBoundingClientRect = previousBounds
    HTMLElement.prototype.animate = previousAnimate
  }
})

test("tile navigation is one camera: zoom into the tile, pull back out of it", async () => {
  const previousBounds = HTMLElement.prototype.getBoundingClientRect
  const previousAnimate = HTMLElement.prototype.animate
  const animations: { element: HTMLElement; keyframes: Keyframe[] }[] = []
  HTMLElement.prototype.getBoundingClientRect = function () {
    const tile = this.hasAttribute("data-disk-tile-path")
    const x = tile ? Number.parseFloat(this.style.left) || 0 : 0
    const y = tile ? Number.parseFloat(this.style.top) || 0 : 0
    const width = tile ? Number.parseFloat(this.style.width) || 0 : 800
    const height = tile ? Number.parseFloat(this.style.height) || 0 : 600
    return {
      x,
      y,
      left: x,
      top: y,
      right: x + width,
      bottom: y + height,
      width,
      height,
    } as DOMRect
  }
  HTMLElement.prototype.animate = function (keyframes, options) {
    if (Array.isArray(keyframes))
      animations.push({ element: this, keyframes: keyframes as Keyframe[] })
    return previousAnimate.call(this, keyframes, options)
  }
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  const child = (name: string, size: number): DiskScanNode => ({
    name,
    path: `/root/folder/${name}`,
    size,
    isDir: true,
    children: [],
    ext: "",
  })
  const first = child("first", 60)
  const second = child("second", 40)
  const folder: DiskScanNode = {
    name: "folder",
    path: "/root/folder",
    size: 100,
    isDir: true,
    children: [first, second],
    ext: "",
  }
  const neighbor: DiskScanNode = {
    name: "neighbor",
    path: "/root/neighbor",
    size: 20,
    isDir: false,
    children: [],
    ext: "bin",
  }
  let prepare: (path: string) => void = () => {}
  const renderAt = (path: string) =>
    root.render(
      <Treemap
        rootPath={path}
        onPrepareNavigation={(capture) => {
          prepare = capture ?? (() => {})
        }}
        colorForPath={() => "oklch(0.7 0.1 200)"}
        colorForNode={() => "oklch(0.7 0.1 200)"}
        children={path === "/root" ? [folder, neighbor] : folder.children}
        hoveredPath={null}
        onHover={() => {}}
        onSelect={() => {}}
        onDrill={() => {}}
        onShowAll={() => {}}
        canCollect={() => false}
        onCollectDragStart={() => {}}
      />
    )
  try {
    await act(async () => renderAt("/root"))
    const openingTile = host
      .querySelector<HTMLElement>(`[data-disk-tile-path="${folder.path}"]`)!
      .getBoundingClientRect()
    prepare(folder.path)
    await act(async () => renderAt(folder.path))
    expect(
      host
        .querySelector("[data-tile-scene-flight]")
        ?.getAttribute("data-tile-scene-flight")
    ).toBe("opening")
    const scale = (transform: unknown) =>
      String(transform)
        .match(/scale\(([-\d.]+), ([-\d.]+)\)/)
        ?.slice(1)
        .map(Number)
    // Zooming in: the new level starts registered inside the opened tile...
    const openingScene = animations.find(
      ({ element, keyframes }) =>
        element.hasAttribute("data-disk-tile-scene") &&
        keyframes[0]?.transform !== undefined
    )!
    const [sx, sy] = scale(openingScene.keyframes[0]?.transform)!
    expect(sx).toBeCloseTo(openingTile.width / 800)
    expect(sy).toBeCloseTo(openingTile.height / 600)
    expect(openingScene.keyframes.at(-1)?.transform).toBe("none")
    // ...while the old world flies outward until that tile fills the view.
    const departing = animations.find(
      ({ element, keyframes }) =>
        element.hasAttribute("data-disk-tile-ghost") &&
        keyframes.at(-1)?.transform !== undefined
    )!
    const [gx, gy] = scale(departing.keyframes.at(-1)?.transform)!
    expect(gx).toBeCloseTo(800 / openingTile.width)
    expect(gy).toBeCloseTo(600 / openingTile.height)
    // Individual tiles never animate on their own during a camera move.
    expect(animations.some(({ element }) => element.dataset.diskTilePath)).toBe(
      false
    )

    animations.length = 0
    prepare("/root")
    await act(async () => renderAt("/root"))
    const returnBox = host
      .querySelector<HTMLElement>(
        `[data-disk-tile-scene] [data-disk-tile-path="${folder.path}"]`
      )!
      .getBoundingClientRect()
    expect(
      host
        .querySelector("[data-tile-scene-flight]")
        ?.getAttribute("data-tile-scene-flight")
    ).toBe("returning")
    // Zooming out mirrors it: the parent starts zoomed into the folder we
    // left and pulls back, while that view shrinks into its tile.
    const returningScene = animations.find(
      ({ element, keyframes }) =>
        element.hasAttribute("data-disk-tile-scene") &&
        keyframes[0]?.transform !== undefined
    )!
    const [rx, ry] = scale(returningScene.keyframes[0]?.transform)!
    expect(rx).toBeCloseTo(800 / returnBox.width)
    expect(ry).toBeCloseTo(600 / returnBox.height)
    const shrinking = animations.find(
      ({ element, keyframes }) =>
        element.hasAttribute("data-disk-tile-ghost") &&
        keyframes.at(-1)?.transform !== undefined
    )!
    const [kx, ky] = scale(shrinking.keyframes.at(-1)?.transform)!
    expect(kx).toBeCloseTo(returnBox.width / 800)
    expect(ky).toBeCloseTo(returnBox.height / 600)
  } finally {
    await act(async () => root.unmount())
    host.remove()
    HTMLElement.prototype.getBoundingClientRect = previousBounds
    HTMLElement.prototype.animate = previousAnimate
  }
})
