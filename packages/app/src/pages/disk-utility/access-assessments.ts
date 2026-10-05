import type { DiskPathAccess, DiskScanNode } from "./types"
import { developerInventoryDeletePrecondition } from "./developer-inventory"

export type AccessState = DiskPathAccess["state"] | "not-checked" | "checking"
export type AccessAssessment = {
  path: string
  state: AccessState
  /** Preserve known restrictions while a retry is in flight. */
  previousState?: DiskPathAccess["state"]
}

function observationIdentity(node: DiskScanNode) {
  return JSON.stringify([
    node.path,
    node.isDir,
    node.size,
    node.modifiedAt,
    developerInventoryDeletePrecondition(node)?.directoryIdentity,
  ])
}

/** Scan-local observations, never an authorization for the final operation.
 * Only requested (inspected, visible, or selected) items enter the bounded queue. */
export function createAccessAssessments(
  check: ((path: string) => Promise<DiskPathAccess>) | undefined,
  concurrency = 3
) {
  type Entry = {
    identity: string
    node: DiskScanNode
    assessment: AccessAssessment
    checkedAt?: number
  }
  const entries = new Map<string, Entry>()
  const listeners = new Set<() => void>()
  const queue: Entry[] = []
  let running = 0
  let revision = 0
  let disposed = false
  function notify() {
    revision++
    for (const listener of listeners) listener()
  }
  function pump() {
    if (disposed) return
    while (running < concurrency && queue.length) {
      const entry = queue.shift()!
      if (entries.get(entry.node.path) !== entry) continue
      running++
      void Promise.resolve()
        .then(() => check!(entry.node.path))
        .catch(() => ({ state: "unknown" as const }))
        .then((result) => {
          if (!disposed && entries.get(entry.node.path) === entry) {
            entry.assessment = { path: entry.node.path, state: result.state }
            entry.checkedAt = Date.now()
            notify()
          }
        })
        .finally(() => {
          running--
          pump()
        })
    }
  }
  function request(node: DiskScanNode, retry = false) {
    const identity = observationIdentity(node)
    const old = entries.get(node.path)
    if (
      old?.identity === identity &&
      !retry &&
      (old.assessment.state === "checking" ||
        Date.now() - (old.checkedAt ?? 0) < 30_000)
    )
      return
    if (!check) return
    const prior = old?.identity === identity ? old.assessment : undefined
    const entry: Entry = {
      identity,
      node,
      assessment: {
        path: node.path,
        state: "checking",
        previousState:
          prior?.state === "checking"
            ? prior.previousState
            : prior?.state === "not-checked"
              ? undefined
              : prior?.state,
      },
    }
    entries.set(node.path, entry)
    queue.push(entry)
    notify()
    pump()
  }
  return {
    request,
    get(node: DiskScanNode): AccessAssessment {
      const entry = entries.get(node.path)
      return entry?.identity === observationIdentity(node)
        ? entry.assessment
        : { path: node.path, state: "not-checked" }
    },
    /** Returning from OS permission settings rechecks only observed items. */
    refresh() {
      for (const entry of entries.values()) request(entry.node, true)
    },
    cancelQueued() {
      for (const entry of queue.splice(0)) {
        if (entries.get(entry.node.path) !== entry) continue
        if (entry.assessment.previousState)
          entry.assessment = {
            path: entry.node.path,
            state: entry.assessment.previousState,
          }
        else entries.delete(entry.node.path)
      }
      notify()
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    snapshot: () => revision,
    dispose() {
      disposed = true
      queue.length = 0
      listeners.clear()
    },
  }
}

export const ACCESS_LABEL = {
  "not-checked": "disk.cleanup.accessNotChecked",
  checking: "disk.cleanup.accessChecking",
  likely: "disk.cleanup.accessLikely",
  denied: "disk.cleanup.accessDenied",
  "read-only": "disk.cleanup.readOnly",
  unknown: "disk.cleanup.accessUnknown",
} as const
