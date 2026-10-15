import type { DiskScanProgress, DiskUtilityAPI } from "./types"

/** One foreground operation owns its progress stream. Supersession invalidates
 * old results; root scans retain late provenance until both IPC channels settle. */
export function createForegroundScans() {
  let generation = 0
  let stopListening: (() => void) | undefined
  const invalidate = () => {
    generation++
    stopListening?.()
    stopListening = undefined
  }

  return {
    invalidate,
    begin(
      api: Pick<DiskUtilityAPI, "onScanProgress" | "scanPath">,
      id: string,
      options: {
        waitForCompletionSource?: boolean
        onProgress: (progress: DiskScanProgress) => void
      }
    ) {
      invalidate()
      const token = generation
      let maxBytes = 0
      let returned = false
      let completionObserved = false
      let unsubscribe: (() => void) | undefined
      const isCurrent = () => token === generation
      const stop = () => {
        unsubscribe?.()
        if (stopListening === stop) stopListening = undefined
        unsubscribe = undefined
      }
      unsubscribe = api.onScanProgress((progress) => {
        if (!isCurrent() || progress.scanId !== id) return
        if (progress.done && progress.source) completionObserved = true
        maxBytes = Math.max(maxBytes, progress.size)
        options.onProgress({ ...progress, size: maxBytes })
        if (returned && completionObserved) stop()
      })
      stopListening = stop
      return {
        isCurrent,
        run: async (
          path: string,
          scanOptions: Parameters<DiskUtilityAPI["scanPath"]>[1]
        ) => {
          const tree = await api.scanPath(path, scanOptions, id)
          returned = !!tree
          return isCurrent() ? tree : undefined
        },
        finish: () => {
          if (
            !options.waitForCompletionSource ||
            !returned ||
            completionObserved
          )
            stop()
        },
      }
    },
  }
}
