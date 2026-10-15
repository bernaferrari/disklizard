import { mergeDiscovery } from "./live-scan"
import { isScanCancellation } from "./scan-progress"
import { asBrowseableRoot, diskPathEquals, includeHiddenSpace } from "./storage"
import type { DiskLizardOS } from "./runtime"
import type {
  DiskDriveInfo,
  DiskScanNode,
  DiskScanProgress,
  DiskUtilityAPI,
} from "./types"
import type { VolumeScanJob } from "./scan-jobs"

export const MAX_PARALLEL_VOLUME_SCANS = 3
type Jobs = Record<string, VolumeScanJob | undefined>
type Target = {
  kind: "volume" | "folder"
  path: string
  label: string
  drive: DiskDriveInfo
}
export type BackgroundScanOptions = {
  api?: Pick<
    DiskUtilityAPI,
    "onScanProgress" | "scanPath" | "cancelScan" | "stopWatching"
  >
  os?: DiskLizardOS
  scanOptions: (
    drive: DiskDriveInfo,
    path: string
  ) => Parameters<DiskUtilityAPI["scanPath"]>[1]
  onScanned: (id: string, tree: DiskScanNode) => void
  onForget: (id: string) => void
  onLimit: () => void
  onReady: (job: VolumeScanJob) => void
  onCompletionSource: (
    id: string,
    source: NonNullable<DiskScanProgress["source"]>
  ) => void
}

/** Owns job identity, concurrency, progress subscriptions and late completions.
 * The synchronous snapshot is authoritative even before React renders a new job. */
export function createBackgroundScans(context: () => BackgroundScanOptions) {
  let jobs: Jobs = {}
  const listeners = new Set<() => void>()
  const subscriptions = new Map<string, () => void>()
  const setJobs = (update: Jobs | ((current: Jobs) => Jobs)) => {
    const next = typeof update === "function" ? update(jobs) : update
    if (next === jobs) return
    jobs = next
    for (const listener of listeners) listener()
  }
  const patch = (id: string, update: Partial<VolumeScanJob>) => {
    const job = jobs[id]
    if (job) setJobs({ ...jobs, [id]: { ...job, ...update } })
  }
  const drop = (id: string) => {
    if (jobs[id]) {
      const next = { ...jobs }
      delete next[id]
      setJobs(next)
    }
  }
  const unsubscribe = (id: string) => {
    subscriptions.get(id)?.()
    subscriptions.delete(id)
  }
  const cancel = (id: string) => {
    unsubscribe(id)
    drop(id)
    context().onForget(id)
    void context().api?.cancelScan(id)
  }
  const close = (id: string) => {
    if (jobs[id]?.status === "scanning") return cancel(id)
    unsubscribe(id)
    drop(id)
    context().onForget(id)
    void context().api?.stopWatching(id)
  }

  const start = (target: Target) => {
    const options = context()
    const api = options.api
    if (!api) return undefined
    const list = Object.values(jobs).filter(
      (job): job is VolumeScanJob => !!job
    )
    const existing = list.find((job) =>
      diskPathEquals(job.sourcePath, target.path, options.os)
    )
    if (existing?.status === "scanning") return undefined
    if (
      list.filter((job) => job.status === "scanning").length >=
      MAX_PARALLEL_VOLUME_SCANS
    ) {
      options.onLimit()
      return undefined
    }
    if (existing) close(existing.id)
    const id = `${target.kind}-${crypto.randomUUID()}`
    setJobs({
      ...jobs,
      [id]: {
        id,
        kind: target.kind,
        status: "scanning",
        label: target.label,
        sourcePath: target.path,
        drive: target.drive,
        files: 0,
        bytes: 0,
        pct: 0,
        currentPath: "",
        startedAt: Date.now(),
      },
    })
    let completionObserved = false
    subscriptions.set(
      id,
      api.onScanProgress((progress) => {
        if (progress.scanId !== id || !jobs[id]) return
        const job = jobs[id]
        if (progress.done && progress.source) {
          completionObserved = true
          patch(id, { source: progress.source })
          context().onCompletionSource(id, progress.source)
          if (job.status !== "scanning") unsubscribe(id)
        }
        if (jobs[id]?.status === "scanning")
          patch(id, {
            files: progress.filesScanned,
            bytes: Math.max(job.bytes, progress.size),
            pct: progress.percent ?? job.pct,
            currentPath: progress.currentPath,
            discoveries: mergeDiscovery(job.discoveries, progress.discovery),
            ...(progress.source ? { source: progress.source } : {}),
          })
      })
    )

    void (async () => {
      let treeReturned = false
      try {
        const scannedTree = await api.scanPath(
          target.path,
          options.scanOptions(target.drive, target.path),
          id
        )
        const current = jobs[id]
        if (!current || current.status !== "scanning") return
        if (!scannedTree) {
          drop(id)
          return
        }
        treeReturned = true
        context().onScanned(id, scannedTree)
        const tree = includeHiddenSpace(
          asBrowseableRoot(scannedTree),
          target.drive
        )
        tree._label = target.label
        const completed: VolumeScanJob = {
          ...current,
          status: "complete",
          tree,
          bytes: tree.size,
          pct: 100,
          currentPath: "",
          completedAt: Date.now(),
        }
        setJobs({ ...jobs, [id]: completed })
        context().onReady(completed)
      } catch (error) {
        if (jobs[id] && !isScanCancellation(error))
          patch(id, {
            status: "failed",
            error: error instanceof Error ? error.message : String(error),
          })
      } finally {
        // Only a successful result can still need a late provenance event.
        if (!treeReturned || completionObserved || !jobs[id]) unsubscribe(id)
      }
    })()
    return id
  }

  return {
    snapshot: () => jobs,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    setJobs,
    patch,
    drop,
    start,
    cancel,
    close,
    dispose: () => {
      for (const id of subscriptions.keys()) unsubscribe(id)
      setJobs({})
    },
  }
}
