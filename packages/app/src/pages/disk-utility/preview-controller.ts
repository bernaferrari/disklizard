import {
  createSurfacePresence,
  type SurfacePhase,
  type SurfacePresenceOptions,
} from "./motion"
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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Own the complete preview lifecycle: one active target, one current read,
 * stale-result rejection, animated close/reset, and navigation through the
 * current visible file set. The page only renders `view()` and dispatches
 * these commands.
 *
 * Framework-free subscribe/snapshot store: `view()` returns one cached object
 * per (state, phase, position) combination, so React consumers can render it
 * via `useSyncExternalStore(controller.subscribe, controller.view)`. Options
 * are captured once — read fresh page state from refs inside the callbacks.
 * Unlike the reactive original, removal of the target by a newer scan
 * generation is not tracked automatically: call `reconcile()` whenever the
 * inputs `isPathCurrent` depends on change, and `dispose()` on unmount.
 */
export function createDiskPreviewController(options: {
  api: () =>
    | Pick<DiskUtilityAPI, "previewPath" | "systemPreviewPath" | "openPath">
    | undefined
  entries: () => readonly DiskScanNode[]
  /** True only while the path belongs to the page's current trusted scan generation. */
  isPathCurrent(path: string): boolean
  os?: DiskPreviewPlatform
  select(path: string): void
  onOperationError?: (operation: DiskPreviewOperation, message: string) => void
  /** Internal scheduling seam used by motion tests and non-browser adapters. */
  surfaceOptions?: SurfacePresenceOptions
}) {
  const listeners = new Set<() => void>()
  const emit = () => {
    for (const listener of listeners) listener()
  }
  const surface = createSurfacePresence(options.surfaceOptions ?? {}, emit)
  // Preview nodes and payloads are immutable scan/IPC values. One shallow
  // state object preserves their identity; a deep reactive store would
  // reconcile plain objects in place and could retain fields from a previous
  // preview kind.
  let state: DiskPreviewState = { target: null, loading: false }
  const setState = (
    next: DiskPreviewState | ((current: DiskPreviewState) => DiskPreviewState)
  ) => {
    state = typeof next === "function" ? next(state) : next
    emit()
  }
  let requestGeneration = 0

  // Visible-file set memoized on the source entries identity, mirroring the
  // reactive memo the original had: one filtered array (and therefore one
  // stable view object) per entries generation, so useSyncExternalStore
  // snapshots never churn between notifications.
  let previewableMemo:
    | { source: readonly DiskScanNode[]; filtered: readonly DiskScanNode[] }
    | undefined
  const previewableEntries = () => {
    const source = options.entries()
    if (previewableMemo && previewableMemo.source === source)
      return previewableMemo.filtered
    const filtered = source.filter(
      (node) => !node.isDir && !node.isOther && !node.isHidden
    )
    previewableMemo = { source, filtered }
    return filtered
  }

  const calculatePosition = (
    current: DiskPreviewState,
    entries: readonly DiskScanNode[]
  ) => {
    if (!current.target) return -1
    return entries.findIndex((node) =>
      diskPathEquals(node.path, current.target!.path, options.os)
    )
  }

  // Position is memoized per (state, visible entries) pair so repeated view()
  // reads — including useSyncExternalStore snapshots — reuse one object.
  let positionMemo:
    | {
        current: DiskPreviewState
        entries: readonly DiskScanNode[]
        value: number
      }
    | undefined
  const positionSnapshot = () => {
    const entries = previewableEntries()
    if (
      positionMemo &&
      positionMemo.current === state &&
      positionMemo.entries === entries
    )
      return positionMemo
    positionMemo = {
      current: state,
      entries,
      value: calculatePosition(state, entries),
    }
    return positionMemo
  }

  const buildView = (
    current: DiskPreviewState,
    phase: SurfacePhase,
    position: number,
    total: number
  ) =>
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

  let viewMemo:
    | {
        current: DiskPreviewState
        phase: SurfacePhase
        position: {
          current: DiskPreviewState
          entries: readonly DiskScanNode[]
          value: number
        }
        value: DiskPreviewView
      }
    | undefined
  const view = () => {
    const current = state
    const phase = surface.phase()
    const position = positionSnapshot()
    if (
      viewMemo &&
      viewMemo.current === current &&
      viewMemo.phase === phase &&
      viewMemo.position === position
    ) {
      return viewMemo.value
    }
    const value = buildView(
      current,
      phase,
      position.value,
      position.entries.length
    )
    viewMemo = { current, phase, position, value }
    return value
  }

  const reset = () => {
    setState({ target: null, loading: false })
  }

  function reconcile() {
    const target = state.target
    if (!target || options.isPathCurrent(target.path)) return true
    requestGeneration += 1
    surface.closeThen(reset)
    return false
  }

  async function show(node: DiskScanNode) {
    const api = options.api()
    if (
      !api ||
      node.isOther ||
      node.isHidden ||
      !options.isPathCurrent(node.path)
    )
      return

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
      if (generation === requestGeneration)
        setState((current) => ({ ...current, loading: false }))
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

  function dispose() {
    requestGeneration += 1
    surface.dispose()
  }

  return {
    view,
    show,
    reconcile,
    close,
    move,
    openInDefaultApp,
    openSystemPreview,
    supportsSystemPreview: () =>
      options.os === "macos" && !!options.api()?.systemPreviewPath,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    dispose,
  }
}
