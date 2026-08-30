import { app } from "electron"
import contextMenu from "electron-context-menu"
import { homedir } from "node:os"

import { CHANNEL, appIdentity } from "./constants"
import { registerIpcHandlers, sendMenuCommand } from "./ipc"
import { exportDebugLogs, initLogging, write as writeLog } from "./logging"
import { createMenu } from "./menu"
import { createUpdaterDialogPresenter, setupAutoUpdater } from "./updater"
import { safeWebContentsURL } from "./window-state"
import {
  getLastFocusedWindow,
  registerRendererProtocol,
  setRelaunchHandler,
  setAppQuitting,
  setBackgroundColor,
  setDockIcon,
  restoreMainWindows,
} from "./windows"
import { cleanupStoreFiles } from "./store-cleanup"
import { setNativeTranslations } from "./native-translations"
import { resolvePackagedSmokeConfig } from "./packaged-smoke"

let logger: ReturnType<typeof initLogging>
const packagedSmokeConfig =
  import.meta.env.DISKLIZARD_PACKAGED_SMOKE === "1"
    ? resolvePackagedSmokeConfig(process.argv, app.isPackaged, true)
    : undefined

async function main() {
  contextMenu({ showSaveImageAs: true, showLookUpSelection: false, showSearchWithGoogle: false })

  try {
    process.chdir(homedir())
  } catch {}

  const identity = appIdentity(CHANNEL, app.isPackaged)
  app.setName(identity.name)
  app.setAppUserModelId(identity.appId)
  app.setPath("userData", packagedSmokeConfig?.userDataPath ?? `${app.getPath("appData")}/${identity.appId}`)
  logger = initLogging()

  const relaunch = () => {
    setAppQuitting()
    app.relaunch()
    app.quit()
  }

  logger.log("app starting", {
    version: app.getVersion(),
    packaged: app.isPackaged,
    channel: CHANNEL,
    product: identity.name,
  })

  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }

  app.on("second-instance", () => {
    const win = getLastFocusedWindow()
    if (win) {
      win.show()
      win.focus()
    }
  })

  app.on("child-process-gone", (_event, details) => {
    writeLog("utility", "child process gone", { details }, "error")
  })

  app.on("render-process-gone", (_event, webContents, details) => {
    writeLog("window", "app render process gone", { url: safeWebContentsURL(webContents), details }, "error")
  })

  setRelaunchHandler(relaunch)

  await app.whenReady()
  await cleanupStoreFiles(app.getPath("userData")).catch((error) => {
    logger.warn("failed to clean scoped store files", error)
  })
  registerRendererProtocol()
  setDockIcon()

  const updater = setupAutoUpdater()
  const updaterPrompt = createUpdaterDialogPresenter(updater)
  const reportUpdaterPromptError = (error: unknown) =>
    writeLog("updater", "failed to present update state", { error }, "error")
  const menuDeps = {
    trigger: (id: string) => {
      const win = getLastFocusedWindow()
      if (win) sendMenuCommand(win, id)
    },
    checkForUpdates: () => void updaterPrompt.manual().catch(reportUpdaterPromptError),
    relaunch,
  }

  registerIpcHandlers({
    relaunch,
    updater,
    showUpdater: () => updaterPrompt.manual(),
    setBackgroundColor: (color) => setBackgroundColor(color),
    exportDebugLogs: () => exportDebugLogs(),
    setNativeTranslations: (bundle) => {
      if (setNativeTranslations(bundle)) createMenu(menuDeps)
    },
    packagedSmokeFixturePath: packagedSmokeConfig?.fixturePath,
  })

  const checkForUpdatesInBackground = () => void updaterPrompt.scheduled().catch(reportUpdaterPromptError)
  const updateTimer = setInterval(checkForUpdatesInBackground, 10 * 60 * 1000)
  updateTimer.unref()
  app.once("will-quit", () => clearInterval(updateTimer))

  app.on("window-all-closed", () => {
    if (process.platform === "darwin") return
    app.quit()
  })
  app.on("activate", () => {
    const win = getLastFocusedWindow()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
      return
    }
    restoreMainWindows()
  })

  const windows = restoreMainWindows()
  if (windows.length) createMenu(menuDeps)
  // Ensure a cached/very fast ready prompt has an application window behind it.
  checkForUpdatesInBackground()
}

void main().catch((error) => {
  console.error(error)
  app.quit()
})
