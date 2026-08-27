export type UpdaterState =
  | { status: "disabled" }
  | { status: "idle" }
  | { status: "checking" }
  | { status: "downloading"; version: string; percent?: number }
  | { status: "ready"; version: string }
  | { status: "up-to-date" }
  | { status: "installing"; version: string }
  | { status: "error"; message: string }

/** Result of a check that defers the download until the user confirms. */
export type UpdateAvailability = { updateAvailable: boolean; version?: string }

export type UpdaterReadyRecord = { version: string }

export type UpdaterBackend = {
  checkForUpdates(): Promise<{ isUpdateAvailable?: boolean; updateInfo?: { version?: string } } | null | undefined>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(): void
}

type UpdaterPersistence = {
  get(): UpdaterReadyRecord | undefined | Promise<UpdaterReadyRecord | undefined>
  set(value: UpdaterReadyRecord): void | Promise<void>
  clear(): void | Promise<void>
}

const DOWNLOAD_ERROR = "No update is available to download"

export function createUpdaterController(input: {
  enabled: boolean
  currentVersion: string
  backend: UpdaterBackend
  persistence: UpdaterPersistence
  stop: () => Promise<void>
  log?: (message: string, data?: object) => void
}) {
  let state: UpdaterState = input.enabled ? { status: "idle" } : { status: "disabled" }
  let pending: Promise<UpdaterState> | undefined
  let availableVersion: string | undefined
  const listeners = new Set<(state: UpdaterState) => void>()

  const transition = (next: UpdaterState) => {
    input.log?.("updater state changed", { from: state.status, to: next.status })
    state = next
    listeners.forEach((listener) => listener(state))
    return state
  }

  const fail = (error: unknown) =>
    transition({ status: "error", message: error instanceof Error ? error.message : String(error) })

  const beginDownload = (version: string) => {
    pending = (async () => {
      availableVersion = undefined
      transition({ status: "downloading", version })
      await input.backend.downloadUpdate()
      await input.persistence.set({ version })
      return transition({ status: "ready", version })
    })()
      .catch((error) => {
        fail(error)
        throw error
      })
      .finally(() => {
        pending = undefined
      })
    return pending
  }

  const check = () => {
    if (!input.enabled) return Promise.resolve(state)
    if (state.status === "ready") return Promise.resolve(state)
    if (pending) return pending

    pending = (async () => {
      transition({ status: "checking" })
      const result = await input.backend.checkForUpdates()
      const version = result?.updateInfo?.version
      if (!result?.isUpdateAvailable || !version || version === input.currentVersion) {
        availableVersion = undefined
        await input.persistence.clear()
        return transition({ status: "up-to-date" })
      }

      await beginDownload(version)
      return state
    })()
      .catch((error) => fail(error))
      .finally(() => {
        pending = undefined
      })
    return pending
  }

  // Check-only variant used by the manual "Check for Updates…" dialog: it
  // learns whether a release exists without pulling the full payload; the
  // download starts only after the user confirms (see `download`).
  const checkOnly = async (): Promise<UpdateAvailability> => {
    if (!input.enabled) return { updateAvailable: false }
    if (state.status === "ready") return { updateAvailable: true }
    if (pending) await pending

    transition({ status: "checking" })
    try {
      const result = await input.backend.checkForUpdates()
      const version = result?.updateInfo?.version
      if (!result?.isUpdateAvailable || !version || version === input.currentVersion) {
        availableVersion = undefined
        await input.persistence.clear()
        transition({ status: "up-to-date" })
        return { updateAvailable: false }
      }
      availableVersion = version
      transition({ status: "idle" })
      return { updateAvailable: true, version }
    } catch (error) {
      fail(error)
      return { updateAvailable: false }
    }
  }

  return {
    getState: () => state,
    subscribe(listener: (state: UpdaterState) => void) {
      listeners.add(listener)
      listener(state)
      return () => listeners.delete(listener)
    },
    async start() {
      const ready = await input.persistence.get()
      if (ready?.version === input.currentVersion) await input.persistence.clear()
      return check()
    },
    check,
    checkOnly,
    /** Download the release a prior `checkOnly` discovered. */
    async download() {
      if (!input.enabled || state.status === "ready") return state
      if (pending) return pending
      const version = availableVersion
      if (!version) throw new Error(DOWNLOAD_ERROR)
      try {
        return await beginDownload(version)
      } catch {
        return state
      }
    },
    /** Drop a pending offer without downloading or installing anything. */
    async dismiss() {
      availableVersion = undefined
      await input.persistence.clear()
      if (state.status === "ready") return transition({ status: "idle" })
      return state
    },
    async install() {
      if (state.status !== "ready") await this.download()
      if (state.status !== "ready") throw new Error("Update is not ready to install")
      const version = state.version
      transition({ status: "installing", version })
      await input
        .stop()
        .then(() => {
          input.backend.quitAndInstall()
          transition({ status: "ready", version })
        })
        .catch((error) => {
          transition({ status: "ready", version })
          throw error
        })
    },
  }
}

export type UpdaterController = ReturnType<typeof createUpdaterController>
