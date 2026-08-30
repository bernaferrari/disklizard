import { describe, expect, test } from "bun:test"
import {
  createUpdaterController,
  UPDATER_DOWNLOAD_POLICY,
  type UpdaterBackend,
  type UpdaterReadyRecord,
} from "./updater-controller"

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((next, fail) => {
    resolve = next
    reject = fail
  })
  return { promise, resolve, reject }
}

function setup(input?: {
  currentVersion?: string
  ready?: UpdaterReadyRecord
  checkForUpdates?: UpdaterBackend["checkForUpdates"]
  downloadUpdate?: UpdaterBackend["downloadUpdate"]
  quitAndInstall?: UpdaterBackend["quitAndInstall"]
  getReadyRecord?: () => UpdaterReadyRecord | undefined | Promise<UpdaterReadyRecord | undefined>
  stop?: () => Promise<void>
}) {
  const calls: string[] = []
  const backend: UpdaterBackend = {
    async checkForUpdates() {
      calls.push("check")
      if (input?.checkForUpdates) return input.checkForUpdates()
      return { isUpdateAvailable: true, updateInfo: { version: "2.0.0" } }
    },
    async downloadUpdate() {
      calls.push("download")
      return input?.downloadUpdate?.()
    },
    async quitAndInstall() {
      calls.push("install")
      if (input?.quitAndInstall) return input.quitAndInstall()
      return new Promise<void>(() => undefined)
    },
  }
  let ready = input?.ready
  const controller = createUpdaterController({
    enabled: true,
    currentVersion: input?.currentVersion ?? "1.0.0",
    backend,
    persistence: {
      get: () => input?.getReadyRecord?.() ?? ready,
      set: (value) => {
        ready = value
      },
      clear: () => {
        ready = undefined
      },
    },
    stop: async () => {
      calls.push("stop")
      await input?.stop?.()
    },
  })
  return { controller, calls, getReady: () => ready }
}

describe("updater controller", () => {
  test("declares background download with confirmation before install", () => {
    expect(UPDATER_DOWNLOAD_POLICY).toBe("background-download-confirm-install")
  })

  test("disabled builds cannot check, download, or install through the controller", async () => {
    const calls: string[] = []
    const controller = createUpdaterController({
      enabled: false,
      currentVersion: "1.0.0",
      backend: {
        async checkForUpdates() {
          calls.push("check")
          return { isUpdateAvailable: true, updateInfo: { version: "2.0.0" } }
        },
        async downloadUpdate() {
          calls.push("download")
        },
        async quitAndInstall() {
          calls.push("install")
        },
      },
      persistence: {
        get() {
          calls.push("persistence:get")
          return { version: "2.0.0" }
        },
        set() {
          calls.push("persistence:set")
        },
        clear() {
          calls.push("persistence:clear")
        },
      },
      async stop() {
        calls.push("stop")
      },
    })

    await expect(controller.start()).resolves.toEqual({ status: "disabled" })
    await expect(controller.checkOnly()).resolves.toEqual({ updateAvailable: false })
    await expect(controller.download()).resolves.toEqual({ status: "disabled" })
    await expect(controller.install()).rejects.toThrow("Update is not ready to install")
    expect(controller.getState()).toEqual({ status: "disabled" })
    expect(calls).toEqual([])
  })

  test("checks, downloads, persists, and publishes one authoritative ready state", async () => {
    const app = setup()
    const states: ReturnType<typeof app.controller.getState>[] = []
    app.controller.subscribe((state) => states.push(state))

    await app.controller.start()

    expect(app.calls).toEqual(["check", "download"])
    expect(app.getReady()).toEqual({ version: "2.0.0" })
    expect(states.map((state) => state.status)).toEqual(["idle", "checking", "downloading", "ready"])
    expect(app.controller.getState()).toEqual({ status: "ready", version: "2.0.0" })
  })

  test("isolates throwing state listeners from updater transitions and other listeners", async () => {
    const app = setup()
    const observed: string[] = []
    expect(() =>
      app.controller.subscribe(() => {
        throw new Error("renderer disappeared")
      }),
    ).not.toThrow()
    app.controller.subscribe((state) => observed.push(state.status))

    await expect(app.controller.start()).resolves.toEqual({ status: "ready", version: "2.0.0" })

    expect(observed).toEqual(["idle", "checking", "downloading", "ready"])
    expect(app.controller.getState()).toEqual({ status: "ready", version: "2.0.0" })
    expect(app.getReady()).toEqual({ version: "2.0.0" })
  })

  test("revalidates a persisted target through the updater cache on launch", async () => {
    const app = setup({ ready: { version: "2.0.0" } })

    await app.controller.start()

    expect(app.calls).toEqual(["check", "download"])
    expect(app.controller.getState()).toEqual({ status: "ready", version: "2.0.0" })
  })

  test("clears a target already installed before checking", async () => {
    const app = setup({ currentVersion: "2.0.0", ready: { version: "2.0.0" } })

    await app.controller.start()

    expect(app.getReady()).toBeUndefined()
    expect(app.calls).toEqual(["check"])
  })

  test("coalesces concurrent checks", async () => {
    const app = setup()

    await Promise.all([app.controller.check(), app.controller.check(), app.controller.check()])

    expect(app.calls).toEqual(["check", "download"])
  })

  test("coalesces concurrent manual checks into the background download policy", async () => {
    const checkStarted = deferred()
    const releaseCheck = deferred<{ isUpdateAvailable: true; updateInfo: { version: string } }>()
    const app = setup({
      checkForUpdates: async () => {
        checkStarted.resolve()
        return releaseCheck.promise
      },
    })

    const checks = [app.controller.checkOnly(), app.controller.checkOnly(), app.controller.checkOnly()]
    await checkStarted.promise
    releaseCheck.resolve({ isUpdateAvailable: true, updateInfo: { version: "2.0.0" } })

    await expect(Promise.all(checks)).resolves.toEqual([
      { updateAvailable: true, version: "2.0.0" },
      { updateAvailable: true, version: "2.0.0" },
      { updateAvailable: true, version: "2.0.0" },
    ])
    expect(app.calls).toEqual(["check", "download"])
    expect(app.controller.getState()).toEqual({ status: "ready", version: "2.0.0" })
  })

  test("a manual check waiting on a background download cannot regress ready", async () => {
    const downloadStarted = deferred()
    const releaseDownload = deferred()
    const app = setup({
      downloadUpdate: async () => {
        downloadStarted.resolve()
        await releaseDownload.promise
      },
    })

    const background = app.controller.check()
    await downloadStarted.promise
    const manual = app.controller.checkOnly()
    releaseDownload.resolve()

    await expect(Promise.all([background, manual])).resolves.toEqual([
      { status: "ready", version: "2.0.0" },
      { updateAvailable: true, version: "2.0.0" },
    ])
    expect(app.calls).toEqual(["check", "download"])
    expect(app.controller.getState()).toEqual({ status: "ready", version: "2.0.0" })
  })

  test("coalesces every caller while one version is downloading", async () => {
    const downloadStarted = deferred()
    const releaseDownload = deferred()
    const app = setup({
      downloadUpdate: async () => {
        downloadStarted.resolve()
        await releaseDownload.promise
      },
    })

    const first = app.controller.check()
    await downloadStarted.promise
    const callers = [app.controller.check(), app.controller.checkOnly(), app.controller.download()]
    releaseDownload.resolve()

    await Promise.all([first, ...callers])
    expect(app.calls).toEqual(["check", "download"])
    expect(app.controller.getState()).toEqual({ status: "ready", version: "2.0.0" })
  })

  test("keeps a downloaded update ready when the user chooses Later", async () => {
    const app = setup()
    await app.controller.start()

    await app.controller.dismiss()
    await app.controller.check()

    expect(app.calls).toEqual(["check", "download"])
    expect(app.getReady()).toEqual({ version: "2.0.0" })
    expect(app.controller.getState()).toEqual({ status: "ready", version: "2.0.0" })
  })

  test("retries a failed background download without retaining a false ready record", async () => {
    let attempts = 0
    const app = setup({
      downloadUpdate: async () => {
        attempts += 1
        if (attempts === 1) throw new Error("network interrupted")
      },
    })

    await app.controller.check()
    expect(app.controller.getState()).toEqual({ status: "error", message: "network interrupted" })
    expect(app.getReady()).toBeUndefined()

    await app.controller.check()
    expect(app.calls).toEqual(["check", "download", "check", "download"])
    expect(app.controller.getState()).toEqual({ status: "ready", version: "2.0.0" })
    expect(app.getReady()).toEqual({ version: "2.0.0" })
  })

  test("retries after an update check fails", async () => {
    let attempts = 0
    const app = setup({
      checkForUpdates: async () => {
        attempts += 1
        if (attempts === 1) throw new Error("feed unavailable")
        return { isUpdateAvailable: true, updateInfo: { version: "2.0.0" } }
      },
    })

    await app.controller.check()
    expect(app.controller.getState()).toEqual({ status: "error", message: "feed unavailable" })

    await app.controller.check()
    expect(app.calls).toEqual(["check", "check", "download"])
    expect(app.controller.getState()).toEqual({ status: "ready", version: "2.0.0" })
  })

  test("retries initialization after a transient persistence failure", async () => {
    let attempts = 0
    const app = setup({
      getReadyRecord: () => {
        attempts += 1
        if (attempts === 1) throw new Error("store unavailable")
        return undefined
      },
    })

    await app.controller.start()
    expect(app.controller.getState()).toEqual({ status: "error", message: "store unavailable" })

    await app.controller.check()
    expect(attempts).toBe(2)
    expect(app.calls).toEqual(["check", "download"])
    expect(app.controller.getState()).toEqual({ status: "ready", version: "2.0.0" })
  })

  test("keeps installation as a terminal handoff and coalesces attempts until an observed failure", async () => {
    const releaseStop = deferred()
    const handoff = deferred()
    const app = setup({
      stop: () => releaseStop.promise,
      quitAndInstall: () => handoff.promise,
    })
    await app.controller.start()

    const installs = [app.controller.install(), app.controller.install(), app.controller.install()]
    releaseStop.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(app.calls).toEqual(["check", "download", "stop", "install"])
    expect(app.controller.getState()).toEqual({ status: "installing", version: "2.0.0" })

    const repeated = app.controller.install()
    expect(app.calls).toEqual(["check", "download", "stop", "install"])

    handoff.reject(new Error("native installer failed"))
    await expect(Promise.all([...installs, repeated])).rejects.toThrow("native installer failed")
    expect(app.controller.getState()).toEqual({ status: "ready", version: "2.0.0" })
  })

  test("treats an installer handoff that unexpectedly returns as a retryable failure", async () => {
    const app = setup({ quitAndInstall: async () => undefined })
    await app.controller.start()

    await expect(app.controller.install()).rejects.toThrow("returned without quitting")

    expect(app.calls).toEqual(["check", "download", "stop", "install"])
    expect(app.controller.getState()).toEqual({ status: "ready", version: "2.0.0" })
  })

  test("returns to ready when installation cannot start", async () => {
    const app = setup()
    await app.controller.start()

    const failed = createUpdaterController({
      enabled: true,
      currentVersion: "1.0.0",
      backend: {
        checkForUpdates: async () => ({ isUpdateAvailable: true, updateInfo: { version: "2.0.0" } }),
        downloadUpdate: async () => {},
        async quitAndInstall() {},
      },
      persistence: { get: () => undefined, set() {}, clear() {} },
      stop: async () => {
        throw new Error("stop failed")
      },
    })
    await failed.start()

    await expect(failed.install()).rejects.toThrow("stop failed")
    expect(failed.getState()).toEqual({ status: "ready", version: "2.0.0" })
  })
})
