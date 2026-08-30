export type UpdaterState =
  | { status: "disabled" }
  | { status: "idle" }
  | { status: "checking" }
  | { status: "downloading"; version: string; percent?: number }
  | { status: "ready"; version: string }
  | { status: "up-to-date" }
  | { status: "installing"; version: string }
  | { status: "error"; message: string }

/** Result of a check after any available update has finished downloading. */
export type UpdateAvailability = { updateAvailable: boolean; version?: string }

/**
 * Untrusted cache hint from the last successful download. It is never enough
 * to restore `ready` by itself: a restarted process revalidates the feed and
 * lets electron-updater verify/reuse its own signed cache before install.
 */
export type UpdaterReadyRecord = { version: string }

export type UpdaterBackend = {
  checkForUpdates(): Promise<{ isUpdateAvailable?: boolean; updateInfo?: { version?: string } } | null | undefined>
  downloadUpdate(): Promise<unknown>
  /** Resolves only when the native installer unexpectedly returns without terminating the app. */
  quitAndInstall(): Promise<void>
}

type UpdaterPersistence = {
  get(): UpdaterReadyRecord | undefined | Promise<UpdaterReadyRecord | undefined>
  set(value: UpdaterReadyRecord): void | Promise<void>
  clear(): void | Promise<void>
}

const DOWNLOAD_ERROR = "No update is available to download"

/** Updates download in the background; installation always requires confirmation. */
export const UPDATER_DOWNLOAD_POLICY = "background-download-confirm-install" as const

export function createUpdaterController(input: {
  enabled: boolean
  currentVersion: string
  backend: UpdaterBackend
  persistence: UpdaterPersistence
  stop: () => Promise<void>
  log?: (message: string, data?: object) => void
}) {
  let state: UpdaterState = input.enabled ? { status: "idle" } : { status: "disabled" }
  let initialization: Promise<void> | undefined
  let checkOperation: Promise<UpdaterState> | undefined
  let downloadOperation: { version: string; promise: Promise<UpdaterState> } | undefined
  let installOperation: Promise<void> | undefined
  let availableVersion: string | undefined
  const listeners = new Set<(state: UpdaterState) => void>()

  const notify = (listener: (state: UpdaterState) => void) => {
    try {
      listener(state)
    } catch (error) {
      input.log?.("updater state listener failed", {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const transition = (next: UpdaterState) => {
    input.log?.("updater state changed", { from: state.status, to: next.status })
    state = next
    listeners.forEach(notify)
    return state
  }

  const fail = (error: unknown) =>
    transition({ status: "error", message: error instanceof Error ? error.message : String(error) })

  const initialize = () => {
    if (initialization) return initialization
    const operation = (async () => {
      const ready = await input.persistence.get()
      if (ready?.version === input.currentVersion) await input.persistence.clear()
    })()
    initialization = operation
    void operation.catch(() => {
      if (initialization === operation) initialization = undefined
    })
    return operation
  }

  const beginDownload = (version: string): Promise<UpdaterState> => {
    if (state.status === "ready") return Promise.resolve(state)
    if (downloadOperation) return downloadOperation.promise

    const promise = (async (): Promise<UpdaterState> => {
      transition({ status: "downloading", version })
      try {
        await input.backend.downloadUpdate()
        await input.persistence.set({ version })
        availableVersion = undefined
        return transition({ status: "ready", version })
      } catch (error) {
        return fail(error)
      }
    })()

    downloadOperation = { version, promise }
    void promise.finally(() => {
      if (downloadOperation?.promise === promise) downloadOperation = undefined
    })
    return promise
  }

  const check = (): Promise<UpdaterState> => {
    if (!input.enabled) return Promise.resolve(state)
    if (state.status === "ready") return Promise.resolve(state)
    if (installOperation) return installOperation.then(() => state)
    if (checkOperation) return checkOperation
    if (downloadOperation) return downloadOperation.promise

    const promise = (async (): Promise<UpdaterState> => {
      try {
        await initialize()
        transition({ status: "checking" })
        const result = await input.backend.checkForUpdates()
        const version = result?.updateInfo?.version
        if (!result?.isUpdateAvailable || !version || version === input.currentVersion) {
          availableVersion = undefined
          await input.persistence.clear()
          return transition({ status: "up-to-date" })
        }

        availableVersion = version
        return await beginDownload(version)
      } catch (error) {
        return fail(error)
      }
    })()

    checkOperation = promise
    void promise.finally(() => {
      if (checkOperation === promise) checkOperation = undefined
    })
    return promise
  }

  // Manual and scheduled checks share one operation and one policy: download
  // in the background, then ask before installation. This keeps the native
  // dialog's "Update downloaded" copy truthful.
  const checkOnly = async (): Promise<UpdateAvailability> => {
    if (!input.enabled) return { updateAvailable: false }
    const result = await check()
    if (result.status === "ready") return { updateAvailable: true, version: result.version }
    return { updateAvailable: false }
  }

  /** Retry a known release after a failed background download. */
  const download = async () => {
    if (!input.enabled || state.status === "ready") return state
    if (checkOperation) return checkOperation
    if (downloadOperation) return downloadOperation.promise
    const version = availableVersion
    if (!version) throw new Error(DOWNLOAD_ERROR)
    return beginDownload(version)
  }

  /** Keep a downloaded update ready when the user chooses "Later". */
  const dismiss = async () => {
    if (checkOperation) await checkOperation
    if (downloadOperation) await downloadOperation.promise
    return state
  }

  const install = async () => {
    if (installOperation) return installOperation
    const operation = (async () => {
      if (state.status !== "ready") await download()
      if (state.status !== "ready") throw new Error("Update is not ready to install")
      const version = state.version
      transition({ status: "installing", version })
      try {
        await input.stop()
        await input.backend.quitAndInstall()
        throw new Error("Update installer returned without quitting")
      } catch (error) {
        transition({ status: "ready", version })
        throw error
      }
    })()
    installOperation = operation
    void operation
      .catch(() => undefined)
      .finally(() => {
        if (installOperation === operation) installOperation = undefined
      })
    return operation
  }

  return {
    getState: () => state,
    subscribe(listener: (state: UpdaterState) => void) {
      listeners.add(listener)
      notify(listener)
      return () => listeners.delete(listener)
    },
    start: check,
    check,
    checkOnly,
    download,
    dismiss,
    install,
  }
}

export type UpdaterController = ReturnType<typeof createUpdaterController>
