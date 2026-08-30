import { app, dialog } from "electron"
import pkg from "electron-updater"
import { CHANNEL, RELEASE_REPOSITORY, UPDATER_ENABLED } from "./constants"
import {
  createUpdaterController,
  UPDATER_DOWNLOAD_POLICY,
  type UpdaterController,
  type UpdaterReadyRecord,
} from "./updater-controller"
import { getLogger } from "./logging"
import { getStore } from "./store"
import { setAppQuitting } from "./windows"
import { nativeT } from "./native-translations"
import { applyUpdaterReleasePolicy, productionUpdaterDowngradeAllowed, updaterAllowsPrerelease } from "./updater-policy"
import { createUpdaterPromptCoordinator } from "./updater-prompt"
import { beginTerminalInstallHandoff } from "./updater-install-handoff"

const { autoUpdater } = pkg
const key = "ready"

export { productionUpdaterDowngradeAllowed, updaterAllowsPrerelease }

export function setupAutoUpdater() {
  const logger = getLogger()
  autoUpdater.logger = logger
  applyUpdaterReleasePolicy(autoUpdater, CHANNEL)
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  logger.log("auto updater configured", {
    enabled: UPDATER_ENABLED,
    channel: autoUpdater.channel,
    downloadPolicy: UPDATER_DOWNLOAD_POLICY,
    releaseRepository: RELEASE_REPOSITORY ? `${RELEASE_REPOSITORY.owner}/${RELEASE_REPOSITORY.repo}` : undefined,
    allowPrerelease: autoUpdater.allowPrerelease,
    allowDowngrade: autoUpdater.allowDowngrade,
    windowsSignatureVerification: process.platform === "win32" ? "electron-updater-default" : undefined,
    currentVersion: app.getVersion(),
  })

  const store = getStore("disklizard.updater")
  return createUpdaterController({
    enabled: UPDATER_ENABLED,
    currentVersion: app.getVersion(),
    backend: {
      checkForUpdates: () => autoUpdater.checkForUpdates(),
      downloadUpdate: () => autoUpdater.downloadUpdate(),
      quitAndInstall: () =>
        beginTerminalInstallHandoff({
          updater: autoUpdater,
          // quitAndInstall closes all windows before emitting before-quit, so
          // flag the quit first to keep window ids persisted for restore.
          onStart: () => setAppQuitting(),
          // A native error is the only supported return path from the terminal
          // handoff. Restore ordinary window-close bookkeeping for a retry.
          onFailure: () => setAppQuitting(false),
        }),
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

export function createUpdaterDialogPresenter(controller: UpdaterController) {
  return createUpdaterPromptCoordinator({
    controller,
    showMessageBox: (options) => dialog.showMessageBox(options),
    messages: {
      get checkFailedMessage() {
        return nativeT("desktop.updater.dialog.checkFailed.message")
      },
      get checkFailedTitle() {
        return nativeT("desktop.updater.dialog.checkFailed.title")
      },
      get installFailedMessage() {
        return nativeT("desktop.updater.dialog.installFailed.message")
      },
      get installFailedTitle() {
        return nativeT("desktop.updater.dialog.installFailed.title")
      },
      get upToDateMessage() {
        return nativeT("desktop.updater.dialog.upToDate.message")
      },
      get upToDateTitle() {
        return nativeT("desktop.updater.dialog.upToDate.title")
      },
      readyMessage: (version) => nativeT("desktop.updater.dialog.ready.message", { version }),
      get readyTitle() {
        return nativeT("desktop.updater.dialog.ready.title")
      },
      get restart() {
        return nativeT("desktop.updater.dialog.restart")
      },
      get retry() {
        return nativeT("desktop.updater.dialog.retry")
      },
      get later() {
        return nativeT("desktop.updater.dialog.later")
      },
    },
    log: (message, data) => getLogger().warn(message, data),
  })
}
