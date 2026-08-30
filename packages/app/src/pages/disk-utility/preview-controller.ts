import { createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { createSurfacePresence, type SurfacePhase } from "./motion"
import { diskPathEquals } from "./storage"
import type { DiskFilePreview, DiskScanNode, DiskUtilityAPI } from "./types"

type DiskPreviewPlatform = "macos" | "windows" | "linux"
type DiskPreviewOperation = "open" | "system-preview"

export type DiskPreviewView = {
  phase: SurfacePhase
  mounted: boolean
  target: DiskScanNode | null
  payload?: DiskFilePreview
  loading: boolean
  error?: string
  position: number
  total: number
  canMovePrevious: boolean
  canMoveNext: boolean
}

type DiskPreviewState = {
  target: DiskScanNode | null
  payload?: DiskFilePreview
  loading: boolean
  error?: string
}

type PreviewSurfaceOptions = Parameters<typeof createSurfacePresence>[0]

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Own the complete preview lifecycle: one active target, one current read,
 * stale-result rejection, animated close/reset, and navigation through the
 * current visible file set. The page only renders `view()` and dispatches
 * these commands.
 */
export function createDiskPreviewController(options: {
  api: () => Pick<DiskUtilityAPI, "previewPath" | "systemPreviewPath" | "openPath"> | undefined
  entries: () => readonly DiskScanNode[]
  /** True only while the path belongs to the page's current trusted scan generation. */
  isPathCurrent(path: string): boolean
  os?: DiskPreviewPlatform
  select(path: string): void
  onOperationError?: (operation: DiskPreviewOperation, message: string) => void
  /** Internal scheduling seam used by motion tests and non-browser adapters. */
  surfaceOptions?: PreviewSurfaceOptions
}) {
  const surface = createSurfacePresence(options.surfaceOptions)
  // Preview nodes and payloads are immutable scan/IPC values. One shallow
  // state signal preserves their identity; a deep store would reconcile plain
  // objects in place and could retain fields from a previous preview kind.
  const [state, setState] = createSignal<DiskPreviewState>({ target: null, loading: false })
  let requestGeneration = 0

  const previewableEntries = createMemo(() =>
    options.entries().filter((node) => !node.isDir && !node.isOther && !node.isHidden),
  )

  const calculatePosition = (current: DiskPreviewState, entries: readonly DiskScanNode[]) => {
    if (!current.target) return -1
    return entries.findIndex((node) => diskPathEquals(node.path, current.target!.path, options.os))
  }

  const positionMemo = createMemo(() => {
    const current = state()
    const entries = previewableEntries()
    return { current, entries, value: calculatePosition(current, entries) }
  })
  const positionSnapshot = () => {
    const current = state()
    const entries = previewableEntries()
    const memoized = positionMemo()
    // Bun's `solid` test condition uses the SSR adapter, whose memos are
    // intentionally one-shot. This fallback keeps that adapter truthful while
    // browser builds take the memoized O(1) path.
    return memoized.current === current && memoized.entries === entries
      ? memoized
      : { current, entries, value: calculatePosition(current, entries) }
  }

  const buildView = (current: DiskPreviewState, phase: SurfacePhase, position: number, total: number) =>
    ({
      phase,
      mounted: phase !== "closed",
      target: current.target,
      payload: current.payload,
      loading: current.loading,
      error: current.error,
      position,
      total,
      canMovePrevious: position > 0,
      canMoveNext: position >= 0 && position + 1 < total,
    }) satisfies DiskPreviewView

  const viewMemo = createMemo(() => {
    const current = state()
    const phase = surface.phase()
    const position = positionSnapshot()
    return {
      current,
      phase,
      position,
      value: buildView(current, phase, position.value, position.entries.length),
    }
  })
  const view = () => {
    const current = state()
    const phase = surface.phase()
    const position = positionSnapshot()
    const memoized = viewMemo()
    return memoized.current === current && memoized.phase === phase && memoized.position === position
      ? memoized.value
      : buildView(current, phase, position.value, position.entries.length)
  }

  const reset = () => {
    setState({ target: null, loading: false })
  }

  function reconcile() {
    const target = state().target
    if (!target || options.isPathCurrent(target.path)) return true
    requestGeneration += 1
    surface.closeThen(reset)
    return false
  }

  // Watcher replacements can remove a target while its dialog is open. Close
  // immediately instead of rendering "0 of N" or leaving actions attached to
  // a path that no longer belongs to the current scan generation.
  createEffect(reconcile)

  async function show(node: DiskScanNode) {
    const api = options.api()
    if (!api || node.isOther || node.isHidden || !options.isPathCurrent(node.path)) return

    const generation = ++requestGeneration
    setState({ target: node, loading: true })
    surface.open()

    if (node.isDir) {
      setState((current) => ({ ...current, loading: false }))
      return
    }

    try {
      const payload = await api.previewPath(node.path)
      if (generation !== requestGeneration) return
      setState((current) => ({ ...current, payload }))
    } catch (error) {
      if (generation !== requestGeneration) return
      setState((current) => ({ ...current, error: errorMessage(error) }))
    } finally {
      if (generation === requestGeneration) setState((current) => ({ ...current, loading: false }))
    }
  }

  function close() {
    requestGeneration += 1
    surface.closeThen(reset)
  }

  function move(delta: -1 | 1) {
    const position = positionSnapshot()
    const next = position.entries[position.value + delta]
    if (!next) return
    options.select(next.path)
    void show(next)
  }

  async function openInDefaultApp(node: DiskScanNode) {
    const api = options.api()
    if (!api || !options.isPathCurrent(node.path)) {
      reconcile()
      return
    }
    try {
      await api.openPath(node.path)
    } catch (error) {
      options.onOperationError?.("open", errorMessage(error))
    }
  }

  async function openSystemPreview(node: DiskScanNode) {
    const api = options.api()
    if (!api || !options.isPathCurrent(node.path)) {
      reconcile()
      return
    }
    try {
      await api.systemPreviewPath(node.path)
    } catch (error) {
      options.onOperationError?.("system-preview", errorMessage(error))
    }
  }

  onCleanup(() => {
    requestGeneration += 1
  })

  return {
    view,
    show,
    reconcile,
    close,
    move,
    openInDefaultApp,
    openSystemPreview,
    supportsSystemPreview: () => options.os === "macos" && !!options.api()?.systemPreviewPath,
  }
}
