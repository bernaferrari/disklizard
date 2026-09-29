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
      const opening = tileCameraAnchor(path, oldPoses)
      const returning = tileCameraAnchor(old.path, tiles)
      if (!opening && !returning) {
        capture?.element.remove()
        return
      }
      const from = opening ?? capture?.bounds ?? presentedRoot ?? old.bounds
      const to = opening ? bounds : returning!
      if (capture) {
        const ghost = capture.element
        outgoing.current = ghost
        const duration = opening && returning ? 560 : 520
        const easing = "cubic-bezier(0.42, 0, 0.18, 1)"
        const motion = { duration, easing }
        const capturedOpacity = Number.parseFloat(ghost.style.opacity)
        const ghostOpacity = Number.isFinite(capturedOpacity)
          ? capturedOpacity
          : 1
        root.dataset.tileCameraMoving = "true"
        root.dataset.tileSceneFlight =
          returning && !opening ? "returning" : "opening"
        root.style.setProperty("--dl-tile-flight-duration", `${duration}ms`)

        if (returning && !opening) {
          const returnKey = [...tiles].find(
            ([, pose]) => pose.box === returning
          )?.[0]
          const shell = returnKey ? tiles.get(returnKey) : undefined
          if (shell && movingScene.contains(shell.element)) {
            // The old view shrinks into its exact parent tile. The parent
            // layout is already at its final position; its matching tile stays
            // hidden until the old view reaches that same rectangle.
            ghost.style.backgroundColor = getComputedStyle(
              shell.element
            ).backgroundColor
            const animations = [
              ghost.animate(
                [
                  { transform: ghost.style.transform || "none", offset: 0 },
                  {
                    transform: cameraTransform(shell.box, bounds, bounds),
                    offset: 0.82,
                  },
                  {
                    transform: cameraTransform(shell.box, bounds, bounds),
                    offset: 1,
                  },
                ],
                motion
              ),
              ghost.animate(
                [
                  { opacity: ghostOpacity, offset: 0 },
                  { opacity: ghostOpacity, offset: 0.82 },
                  { opacity: 0, offset: 1 },
                ],
                { duration }
              ),
              ...[...tiles.values()]
                .filter(
                  (tile) =>
                    movingScene.contains(tile.element) &&
                    tile.box.x >= shell.box.x &&
                    tile.box.y >= shell.box.y &&
                    tile.box.x + tile.box.width <=
                      shell.box.x + shell.box.width + 0.5 &&
                    tile.box.y + tile.box.height <=
                      shell.box.y + shell.box.height + 0.5
                )
                .map((tile) =>
                  tile.element.animate(
                    [
                      { opacity: 0, offset: 0 },
                      { opacity: 0, offset: 0.82 },
                      { opacity: 1, offset: 1 },
                    ],
                    { duration }
                  )
                ),
            ]
            active.current = animations
            void Promise.allSettled(
              animations.map((animation) => animation.finished)
            ).then(() => {
              if (active.current === animations) stop()
            })
            return
          }
        }

        // The new scene starts exactly inside the old selected tile and
        // expands as a single opaque surface. The old view remains behind it,
        // preserving the context around the growing rectangle.
        const openingKey = [...oldPoses].find(
          ([, pose]) => pose.box === opening
        )?.[0]
        const sourceTile =
          opening && containsPath(old.path, path)
            ? [
                ...ghost.querySelectorAll<HTMLElement>("[data-disk-tile-path]"),
              ].find((tile) => tile.dataset.diskTilePath === openingKey)
            : undefined
        const sourceBackground = sourceTile
          ? getComputedStyle(sourceTile).backgroundColor ||
            "var(--background-base)"
          : undefined
        if (sourceBackground)
          movingScene.style.backgroundColor = sourceBackground
        movingScene.style.zIndex = "4"
        const animations = [
          movingScene.animate(
            [
              {
                transform: cameraTransform(from, bounds, bounds),
                transformOrigin: "0 0",
              },
              { transform: "none", transformOrigin: "0 0", offset: 0.72 },
              { transform: "none", transformOrigin: "0 0", offset: 1 },
            ],
            motion
          ),
        ]
        // An opaque shared surface must cover the old branch during zoom.
        // Fading the whole scene exposed two incompatible layouts at once.
        // Resolve new contents only once the shared surface has landed.
        const content = movingScene.querySelector<HTMLElement>(
          "[data-disk-tile-content]"
        )
        if (sourceBackground && content) {
          // Carry the actual old branch inside the growing surface. Its
          // projection cancels the camera's initial scale, so the first frame
          // is the selected tile at its original size, with its own contents.
          const shared = document.createElement("div")
          shared.dataset.diskTileShared = ""
          shared.setAttribute("aria-hidden", "true")
          shared.setAttribute("inert", "")
          shared.style.cssText =
            "position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:2"
          const branch = ghost.cloneNode(true) as HTMLElement
          branch.removeAttribute("data-disk-tile-ghost")
          branch.style.transformOrigin = "0 0"
          const capturedTransform = branch.style.transform
          branch.style.transform = `${cameraTransform(bounds, from, bounds)} ${capturedTransform && capturedTransform !== "none" ? capturedTransform : ""}`
          shared.append(branch)
          movingScene.append(shared)
          animations.push(
            shared.animate(
              [
                { opacity: 1, offset: 0 },
                { opacity: 1, offset: 0.72 },
                { opacity: 0, offset: 1 },
              ],
              { duration }
            )
          )
          animations.push(
            content.animate(
              [
                { opacity: 0, offset: 0 },
                { opacity: 0, offset: 0.72 },
                { opacity: 1, offset: 1 },
              ],
              { duration }
            )
          )
        } else
          animations.push(
            movingScene.animate(
              [
                { opacity: 0, offset: 0 },
                { opacity: 1, offset: 0.18 },
                { opacity: 1, offset: 1 },
              ],
              { duration }
            )
          )
        if (sourceBackground)
          animations.push(
            movingScene.animate(
              [
                { backgroundColor: sourceBackground, offset: 0 },
                { backgroundColor: "var(--background-base)", offset: 0.72 },
                { backgroundColor: "var(--background-base)", offset: 1 },
              ],
              { duration }
            )
          )
        active.current = animations
        void Promise.allSettled(
          animations.map((animation) => animation.finished)
        ).then(() => {
          if (active.current === animations) stop()
        })
        return
      }
      const animation = movingScene.animate(
        [
          {
            transform: tileCameraZoomTransform(from, to, bounds),
            transformOrigin: "0 0",
          },
          { transform: "none", transformOrigin: "0 0" },
        ],
        { duration: 260, easing: "cubic-bezier(0.32, 0.72, 0, 1)" }
      )
      root.dataset.tileCameraMoving = "true"
      active.current = [animation]
      const revealLabels = () => {
        if (active.current[0] !== animation) return
        active.current = []
        root.removeAttribute("data-tile-camera-moving")
      }
      void animation.finished.then(revealLabels, revealLabels)
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
