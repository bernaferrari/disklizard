import { useLayoutEffect, useRef } from "react"
import type { CameraBox } from "./directory-camera"
import type { NestedTile } from "./nested-treemap"
import type { DiskScanNode } from "./types"

type TilePose = { box: CameraBox; element: HTMLElement; node: DiskScanNode }
type Scene = { path: string; bounds: CameraBox; tiles: Map<string, TilePose> }
type PreparedScene = {
  path: string
  element: HTMLElement
  bounds: CameraBox
  tiles: Map<string, CameraBox>
  timeout: ReturnType<typeof setTimeout>
}

function containsPath(parent: string, path: string) {
  const prefix = parent.replaceAll("\\", "/").replace(/\/+$/, "") + "/"
  return path.replaceAll("\\", "/").startsWith(prefix)
}

export function tileCameraAnchor(
  path: string,
  tiles: ReadonlyMap<string, Pick<TilePose, "box" | "node">>
) {
  const exact = tiles.get(path)
  if (exact) return exact.box
  let nearest: Pick<TilePose, "box" | "node"> | undefined
  for (const tile of tiles.values()) {
    const contains =
      (tile.node.isDir && containsPath(tile.node.path, path)) ||
      (tile.node.isOther &&
        tile.node.children.some(
          (child) =>
            child.path === path ||
            (child.isDir && containsPath(child.path, path))
        ))
    if (
      contains &&
      (!nearest ||
        tile.node.path.length > nearest.node.path.length ||
        (tile.node.path.length === nearest.node.path.length &&
          tile.box.width * tile.box.height <
            nearest.box.width * nearest.box.height))
    )
      nearest = tile
  }
  return nearest?.box
}

function project(box: CameraBox, from: CameraBox, to: CameraBox): CameraBox {
  const sx = to.width / Math.max(1, from.width),
    sy = to.height / Math.max(1, from.height)
  return {
    x: to.x + (box.x - from.x) * sx,
    y: to.y + (box.y - from.y) * sy,
    width: box.width * sx,
    height: box.height * sy,
  }
}
function cameraTransform(from: CameraBox, to: CameraBox, root: CameraBox) {
  const sx = from.width / Math.max(1, to.width)
  const sy = from.height / Math.max(1, to.height)
  return `translate(${from.x - root.x - (to.x - root.x) * sx}px, ${from.y - root.y - (to.y - root.y) * sy}px) scale(${sx}, ${sy})`
}

/** Camera navigation preserves shape; individual tile reflow may resize it. */
export function tileCameraZoomTransform(
  from: CameraBox,
  to: CameraBox,
  root: CameraBox
) {
  const scale = Math.min(
    from.width / Math.max(1, to.width),
    from.height / Math.max(1, to.height)
  )
  const fromX = from.x + from.width / 2 - root.x
  const fromY = from.y + from.height / 2 - root.y
  const toX = to.x + to.width / 2 - root.x
  const toY = to.y + to.height / 2 - root.y
  return `translate(${fromX - toX * scale}px, ${fromY - toY * scale}px) scale(${scale})`
}

export const TILE_CAMERA_DURATION = 520
export const TILE_CAMERA_EASING = "cubic-bezier(0.65, 0, 0.35, 1)"

export type TileCameraFlight = {
  kind: "opening" | "returning" | "lateral"
  /** Transform of the arriving level, from and to. */
  scene: [string, string]
  /** Final transform of the departing level (it starts where it was). */
  ghost: string
  /** When the arriving level fades in, as offsets of the flight. */
  reveal: [number, number]
  /** When the departing level fades out. */
  fade: [number, number]
}

/**
 * Plan one camera move over a static world.
 *
 * Opening: the camera flies into the opened tile — the old world scales
 * until that tile fills the view, siblings sweep out past the edges, and the
 * new level resolves inside it. Returning is the mirror: the parent world
 * starts zoomed into the tile we came from and pulls back, while the view we
 * leave shrinks into that tile. Switching to a sibling slides sideways.
 */
export function tileCameraFlight(
  fromPath: string,
  toPath: string,
  opening: CameraBox | undefined,
  returning: CameraBox | undefined,
  bounds: CameraBox
): TileCameraFlight | undefined {
  const deeper = containsPath(fromPath, toPath)
  const shallower = containsPath(toPath, fromPath)
  if (deeper && opening)
    return {
      kind: "opening",
      scene: [cameraTransform(opening, bounds, bounds), "none"],
      ghost: cameraTransform(bounds, opening, bounds),
      reveal: [0.34, 0.78],
      fade: [0.5, 0.86],
    }
  if (shallower && returning)
    return {
      kind: "returning",
      scene: [cameraTransform(bounds, returning, bounds), "none"],
      ghost: cameraTransform(returning, bounds, bounds),
      // The parent is the world we are pulling back into: show it at once,
      // under the view that is shrinking away into its tile.
      reveal: [0, 0.3],
      fade: [0.3, 0.72],
    }
  if (!deeper && !shallower && (opening || returning)) {
    // A sibling: same depth, so the camera pans rather than zooms. The
    // direction follows where the sibling sits relative to the current one.
    const target = opening ?? returning!
    const direction =
      target.x + target.width / 2 < bounds.x + bounds.width / 2 ? -1 : 1
    const shift = Math.round(bounds.width * 0.08) * direction
    return {
      kind: "lateral",
      scene: [`translate(${shift}px, 0px)`, "none"],
      ghost: `translate(${-shift}px, 0px)`,
      reveal: [0.15, 0.7],
      fade: [0, 0.5],
    }
  }
  return undefined
}

/** Navigate as one camera move; reflow only the largest changed tiles. */
export function useTileCamera(
  path: string,
  layout: readonly NestedTile[],
  contextNodes: readonly DiskScanNode[] = []
) {
  const rootRef = useRef<HTMLDivElement>(null)
  const scene = useRef<Scene | null>(null)
  const active = useRef<Animation[]>([])
  const outgoing = useRef<HTMLElement | null>(null)
  const prepared = useRef<PreparedScene | null>(null)
  const stop = () => {
    active.current.forEach((animation) => animation.cancel())
    active.current = []
    outgoing.current?.remove()
    outgoing.current = null
    const root = rootRef.current
    root?.removeAttribute("data-tile-camera-moving")
    root?.removeAttribute("data-tile-scene-flight")
    root?.style.removeProperty("--dl-tile-flight-duration")
    root
      ?.querySelector<HTMLElement>("[data-disk-tile-scene]")
      ?.style.removeProperty("z-index")
    root
      ?.querySelector<HTMLElement>("[data-disk-tile-scene]")
      ?.style.removeProperty("background-color")
    root
      ?.querySelector<HTMLElement>("[data-disk-tile-ghost-host]")
      ?.style.removeProperty("z-index")
    root
      ?.querySelectorAll("[data-disk-tile-scene] [data-disk-tile-shared]")
      .forEach((element) => element.remove())
  }
  const prepareNavigation = (destination: string) => {
    const root = rootRef.current
    const movingScene = root?.querySelector<HTMLElement>(
      "[data-disk-tile-scene]"
    )
    const host = root?.querySelector<HTMLElement>("[data-disk-tile-ghost-host]")
    if (
      !movingScene ||
      !host ||
      scene.current?.path === destination ||
      matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return

    // Capture the presented pose before cancelling an interrupted flight.
    const presentation = getComputedStyle(movingScene)
    const presentedBounds = movingScene.getBoundingClientRect()
    const presentedTiles = new Map(
      [...(scene.current?.tiles ?? [])].map(([key, tile]) => [
        key,
        tile.element.getBoundingClientRect(),
      ])
    )
    const ghost = movingScene.cloneNode(true) as HTMLElement
    ghost.removeAttribute("data-disk-tile-scene")
    ghost.dataset.diskTileGhost = ""
    ghost.setAttribute("aria-hidden", "true")
    ghost.setAttribute("inert", "")
    ghost.style.transform = presentation.transform
    ghost.style.transformOrigin = "0 0"
    ghost.style.opacity = presentation.opacity
    ghost.style.backgroundColor = presentation.backgroundColor
    // WAAPI presentation values are not copied by cloneNode. Freeze each
    // visible tile before cancelling the interrupted flight, including the
    // partial reveal of newly exposed detail and labels.
    if (active.current.length) {
      const originals = movingScene.querySelectorAll<HTMLElement>(
        "[data-disk-tile-shared], [data-disk-tile-content], [data-disk-tile-path], .dl-treemap-text"
      )
      const copies = ghost.querySelectorAll<HTMLElement>(
        "[data-disk-tile-shared], [data-disk-tile-content], [data-disk-tile-path], .dl-treemap-text"
      )
      originals.forEach((original, index) => {
        const copy = copies[index]
        if (!copy) return
        const style = getComputedStyle(original)
        copy.style.transform = style.transform
        copy.style.opacity = style.opacity
        if (original.hasAttribute("data-disk-tile-path"))
          copy.style.transformOrigin = "0 0"
      })
    }
    stop()
    if (prepared.current) {
      clearTimeout(prepared.current.timeout)
      prepared.current.element.remove()
    }
    host.replaceChildren(ghost)
    const timeout = setTimeout(() => {
      if (prepared.current?.element !== ghost) return
      ghost.remove()
      prepared.current = null
    }, 1500)
    prepared.current = {
      path: destination,
      element: ghost,
      bounds: presentedBounds,
      tiles: presentedTiles,
      timeout,
    }
  }
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    // The parent and sibling controls stay fixed while the tile world moves.
    const movingScene =
      root.querySelector<HTMLElement>("[data-disk-tile-scene]") ?? root
    const old = scene.current
    const presentedRoot = old ? movingScene.getBoundingClientRect() : undefined
    const presented = new Map<string, CameraBox>()
    if (old?.path === path)
      for (const [key, tile] of old.tiles) {
        const css = getComputedStyle(tile.element).transform
        const matrix =
          css && css !== "none" ? new DOMMatrixReadOnly(css) : undefined
        const tilePose = matrix
          ? {
              x: tile.box.x + matrix.e,
              y: tile.box.y + matrix.f,
              width: tile.box.width * matrix.a,
              height: tile.box.height * matrix.d,
            }
          : tile.box
        // A reflow can arrive while the whole camera is still zooming. Read
        // that presentation transform too, or the tiles jump when it cancels.
        presented.set(
          key,
          presentedRoot
            ? project(tilePose, old.bounds, presentedRoot)
            : tilePose
        )
      }
    const capture = prepared.current?.path === path ? prepared.current : null
    if (prepared.current) {
      clearTimeout(prepared.current.timeout)
      if (!capture) prepared.current.element.remove()
      prepared.current = null
    }
    stop()
    const bounds = movingScene.getBoundingClientRect()
    const elements = [
      ...movingScene.querySelectorAll<HTMLElement>("[data-disk-tile-path]"),
      ...root.querySelectorAll<HTMLElement>("[data-disk-sibling-path]"),
    ]
    const nodes = new Map([
      ...layout.map((tile) => [tile.node.path, tile.node] as const),
      ...contextNodes.map((node) => [node.path, node] as const),
    ])
    const tiles = new Map(
      elements.flatMap((element) => {
        const path =
          element.dataset.diskTilePath ?? element.dataset.diskSiblingPath!
        const node = nodes.get(path)
        return node
          ? [
              [
                path,
                { box: element.getBoundingClientRect(), element, node },
              ] as const,
            ]
          : []
      })
    )
    scene.current = { path, bounds, tiles }
    if (
      !old ||
      !bounds.width ||
      !bounds.height ||
      matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      capture?.element.remove()
      return
    }
    if (old.path !== path) {
      const oldPoses = new Map(
        [...old.tiles].map(([key, tile]) => [
          key,
          {
            ...tile,
            box:
              capture?.tiles.get(key) ??
              project(tile.box, old.bounds, presentedRoot ?? old.bounds),
          },
        ])
      )
      const ghost = capture?.element
      const flight = tileCameraFlight(
        old.path,
        path,
        tileCameraAnchor(path, oldPoses),
        tileCameraAnchor(old.path, tiles),
        bounds
      )
      if (!flight) {
        ghost?.remove()
        return
      }
      root.dataset.tileCameraMoving = "true"
      root.dataset.tileSceneFlight = flight.kind
      root.style.setProperty(
        "--dl-tile-flight-duration",
        `${TILE_CAMERA_DURATION}ms`
      )
      const motion = {
        duration: TILE_CAMERA_DURATION,
        easing: TILE_CAMERA_EASING,
      }
      const animations: Animation[] = []
      // Without a snapshot of the departing level there is nothing to fade
      // from, so the arriving level must show from the first frame.
      const reveal = ghost ? flight.reveal : ([0, 0.22] as const)
      // Both worlds ride the same camera, so they stay registered while
      // they crossfade: the old level's nested tiles land exactly where the
      // new level draws them.
      animations.push(
        movingScene.animate(
          [
            { transform: flight.scene[0], transformOrigin: "0 0" },
            { transform: flight.scene[1], transformOrigin: "0 0" },
          ],
          motion
        ),
        movingScene.animate(
          [
            { opacity: 0, offset: 0 },
            { opacity: 0, offset: reveal[0] },
            { opacity: 1, offset: reveal[1] },
            { opacity: 1, offset: 1 },
          ],
          { duration: TILE_CAMERA_DURATION }
        )
      )
      if (ghost) {
        outgoing.current = ghost
        const startTransform =
          ghost.style.transform && ghost.style.transform !== "none"
            ? ghost.style.transform
            : "none"
        const capturedOpacity = Number.parseFloat(ghost.style.opacity)
        const ghostOpacity = Number.isFinite(capturedOpacity)
          ? capturedOpacity
          : 1
        // Zooming in, the new level fades in over the old one; zooming out,
        // the old level shrinks into its tile above the arriving parent.
        if (flight.kind === "returning") {
          root
            .querySelector<HTMLElement>("[data-disk-tile-ghost-host]")
            ?.style.setProperty("z-index", "5")
        } else movingScene.style.zIndex = "4"
        animations.push(
          ghost.animate(
            [
              { transform: startTransform, transformOrigin: "0 0" },
              { transform: flight.ghost, transformOrigin: "0 0" },
            ],
            motion
          ),
          ghost.animate(
            [
              { opacity: ghostOpacity, offset: 0 },
              { opacity: ghostOpacity, offset: flight.fade[0] },
              { opacity: 0, offset: flight.fade[1] },
              { opacity: 0, offset: 1 },
            ],
            { duration: TILE_CAMERA_DURATION }
          )
        )
      }
      active.current = animations
      void Promise.allSettled(
        animations.map((animation) => animation.finished)
      ).then(() => {
        if (active.current === animations) stop()
      })
      return
    }

    // A drag preview can change hundreds of tiny rectangles at once. Keep
    // their layout accurate, but animate only the largest visible moves.
    const changed = [...tiles].filter(([key, tile]) => {
      const from = presented.get(key)
      return (
        from &&
        (Math.abs(from.x - tile.box.x) > 1 ||
          Math.abs(from.y - tile.box.y) > 1 ||
          Math.abs(from.width - tile.box.width) > 1 ||
          Math.abs(from.height - tile.box.height) > 1)
      )
    })
    changed.sort(
      (a, b) =>
        b[1].box.width * b[1].box.height - a[1].box.width * a[1].box.height
    )
    const animations: Animation[] = []
    for (const [key, tile] of changed.slice(0, 160)) {
      const from = presented.get(key)!
      animations.push(
        tile.element.animate(
          [
            {
              transform: cameraTransform(from, tile.box, tile.box),
              transformOrigin: "0 0",
              opacity: 1,
            },
            { transform: "none", transformOrigin: "0 0", opacity: 1 },
          ],
          { duration: 180, easing: "cubic-bezier(0.32, 0.72, 0, 1)" }
        )
      )
    }
    active.current = animations
    void Promise.all(animations.map((animation) => animation.finished))
      .then(() => {
        if (active.current === animations) stop()
      })
      .catch(() => undefined)
  }, [path, layout, contextNodes])
  useLayoutEffect(
    () => () => {
      stop()
      if (prepared.current) {
        clearTimeout(prepared.current.timeout)
        prepared.current.element.remove()
        prepared.current = null
      }
    },
    []
  )
  return { rootRef, prepareNavigation }
}
