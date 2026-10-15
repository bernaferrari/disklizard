import type { DiskDriveInfo, DiskScanNode } from "./types"

type ScanLocation = {
  label: string
  sourcePath: string
  drive?: DiskDriveInfo
  activeID?: string
}
type ReadyScan = ScanLocation & { root: DiskScanNode; node: DiskScanNode }
export type ScanWorkspace =
  | {
      phase: "home"
      root: null
      node: null
      label: ""
      sourcePath: ""
      drive?: undefined
      activeID?: undefined
      foregroundID?: undefined
      focused?: undefined
    }
  | (ScanLocation & {
      phase: "scanning"
      root: null
      node: null
      activeID: string
      foregroundID: string
      focused?: undefined
    })
  | (ReadyScan & {
      phase: "ready"
      foregroundID?: undefined
      focused?: undefined
    })
  | (ReadyScan & {
      phase: "expanding"
      foregroundID: string
      focused: { label: string }
    })
export type ScanWorkspaceEvent =
  | { type: "home" }
  | { type: "open"; scan: ReadyScan }
  | { type: "begin"; id: string; location: Omit<ScanLocation, "activeID"> }
  | { type: "expand"; id: string; label: string }
  | { type: "complete"; id: string; root: DiskScanNode; node?: DiskScanNode }
  | { type: "finish"; id: string }
  | { type: "fail"; id: string }
  | { type: "cancel"; id?: string }
  | { type: "navigate"; node: DiskScanNode }
  | { type: "replace-tree"; root: DiskScanNode; node: DiskScanNode }
export const EMPTY_SCAN_WORKSPACE: ScanWorkspace = {
  phase: "home",
  root: null,
  node: null,
  label: "",
  sourcePath: "",
}

/** The authoritative viewport transition. Native completions must name the request
 * they belong to; a superseded request cannot replace a newer scan or parked map. */
export function transitionScanWorkspace(
  state: ScanWorkspace,
  event: ScanWorkspaceEvent
): ScanWorkspace {
  switch (event.type) {
    case "home":
      return EMPTY_SCAN_WORKSPACE
    case "open":
      return { ...event.scan, phase: "ready" }
    case "begin":
      return {
        ...event.location,
        phase: "scanning",
        root: null,
        node: null,
        activeID: event.id,
        foregroundID: event.id,
      }
    case "expand":
      return state.root
        ? {
            ...state,
            phase: "expanding",
            foregroundID: event.id,
            focused: { label: event.label },
          }
        : state
    case "complete":
      return state.foregroundID === event.id
        ? {
            phase: "ready",
            root: event.root,
            node: event.node ?? event.root,
            activeID: state.activeID,
            label: state.label,
            sourcePath: state.sourcePath,
            drive: state.drive,
          }
        : state
    case "finish":
    case "cancel": {
      if (state.foregroundID !== event.id) return state
      if (state.phase === "scanning") return EMPTY_SCAN_WORKSPACE
      return state.root
        ? {
            phase: "ready",
            root: state.root,
            node: state.node,
            activeID: state.activeID,
            label: state.label,
            sourcePath: state.sourcePath,
            drive: state.drive,
          }
        : state
    }
    case "fail":
      return state.foregroundID === event.id ? EMPTY_SCAN_WORKSPACE : state
    case "navigate":
      return state.root ? { ...state, node: event.node } : state
    case "replace-tree":
      return state.root
        ? { ...state, root: event.root, node: event.node }
        : state
  }
  const exhaustive: never = event
  return exhaustive
}
