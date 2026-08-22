import { app, dialog } from "electron"
import pkg from "electron-updater"
import { CHANNEL, UPDATER_ENABLED, updaterFeedChannel } from "./constants"
import { createUpdaterController, type UpdaterReadyRecord } from "./updater-controller"
import { getLogger } from "./logging"
import { getStore } from "./store"
import { setAppQuitting } from "./windows"
import { nativeT } from "./native-translations"
import { productionUpdaterDowngradeAllowed, productionVerifyUpdateCodeSignature } from "./updater-policy"

const { autoUpdater } = pkg
const key = "ready"

export { productionUpdaterDowngradeAllowed, productionVerifyUpdateCodeSignature }

export function setupAutoUpdater() {
  const logger = getLogger()
  autoUpdater.logger = logger
  autoUpdater.channel = updaterFeedChannel(CHANNEL)
  autoUpdater.allowPrerelease = false
  autoUpdater.allowDowngrade = productionUpdaterDowngradeAllowed(CHANNEL)
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  const windowsUpdater = autoUpdater as typeof autoUpdater & { verifyUpdateCodeSignature?: boolean }
  if (process.platform === "win32") {
    windowsUpdater.verifyUpdateCodeSignature = productionVerifyUpdateCodeSignature()
  }
  logger.log("auto updater configured", {
    channel: autoUpdater.channel,
    allowPrerelease: autoUpdater.allowPrerelease,
    allowDowngrade: autoUpdater.allowDowngrade,
    verifyUpdateCodeSignature: process.platform === "win32" ? windowsUpdater.verifyUpdateCodeSignature : undefined,
    currentVersion: app.getVersion(),
  })

  const store = getStore("disklizard.updater")
  return createUpdaterController({
    enabled: UPDATER_ENABLED,
    currentVersion: app.getVersion(),
    backend: {
      checkForUpdates: () => autoUpdater.checkForUpdates(),
      downloadUpdate: () => autoUpdater.downloadUpdate(),
      quitAndInstall: () => {
        // quitAndInstall closes all windows before emitting before-quit, so
        // flag the quit first to keep window ids persisted for restore.
        setAppQuitting()
        try {
          autoUpdater.quitAndInstall()
        } catch (error) {
          // The install failed and the app keeps running; clear the flag so
          // deliberate window closes prune ids again.
          setAppQuitting(false)
          throw error
        }
      },
    },
    persistence: {
      get() {
        const value = store.get(key)
        if (!value || typeof value !== "object" || !("version" in value) || typeof value.version !== "string") return
        return { version: value.version } satisfies UpdaterReadyRecord
      },
      set: (value) => store.set(key, value),
      clear: () => store.delete(key),
    },
    stop: async () => undefined,
    log: (message, data) => logger.log(message, data),
  })
}

export async function showUpdaterDialog(controller: ReturnType<typeof setupAutoUpdater>, alertOnFail: boolean) {
  const state = await controller.check()
  if (state.status === "error") {
    if (!alertOnFail) return
    await dialog.showMessageBox({
      type: "error",
      message: nativeT("desktop.updater.dialog.checkFailed.message"),
      title: nativeT("desktop.updater.dialog.checkFailed.title"),
    })
    return
  }
  if (state.status === "up-to-date") {
    if (!alertOnFail) return
    await dialog.showMessageBox({
      type: "info",
      message: nativeT("desktop.updater.dialog.upToDate.message"),
      title: nativeT("desktop.updater.dialog.upToDate.title"),
    })
    return
  }
  if (state.status !== "ready") return

  const response = await dialog.showMessageBox({
    type: "info",
    message: nativeT("desktop.updater.dialog.ready.message", { version: state.version }),
    title: nativeT("desktop.updater.dialog.ready.title"),
    buttons: [nativeT("desktop.updater.dialog.restart"), nativeT("desktop.updater.dialog.later")],
    defaultId: 0,
    cancelId: 1,
  })
  if (response.response === 0) await controller.install()
}
