import { app, BrowserWindow } from "electron"
import contextMenu from "electron-context-menu"
import { homedir } from "node:os"

import { APP_PROTOCOL, CHANNEL, appIdentity } from "./constants"
import { registerIpcHandlers, sendDeepLinks, sendMenuCommand } from "./ipc"
import { exportDebugLogs, initCrashReporter, initLogging, write as writeLog } from "./logging"
import { createMenu } from "./menu"
import { setupAutoUpdater, showUpdaterDialog } from "./updater"
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

const pendingDeepLinks: string[] = []
let logger: ReturnType<typeof initLogging>

function emitDeepLinks(urls: string[]) {
  if (urls.length === 0) return
  pendingDeepLinks.push(...urls)
  const win = getLastFocusedWindow()
  if (win) sendDeepLinks(win, urls)
}

async function main() {
  contextMenu({ showSaveImageAs: true, showLookUpSelection: false, showSearchWithGoogle: false })

  try {
    process.chdir(homedir())
  } catch {}

  const identity = appIdentity(CHANNEL, app.isPackaged)
  app.setName(identity.name)
  app.setAppUserModelId(identity.appId)
  app.setPath("userData", `${app.getPath("appData")}/${identity.appId}`)
  logger = initLogging()
  initCrashReporter()

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

  app.on("second-instance", (_event, argv: string[]) => {
    const urls = argv.filter((arg: string) => arg.startsWith(`${APP_PROTOCOL}://`))
    if (urls.length) {
      logger.log("deep link received via second-instance", { urls })
      emitDeepLinks(urls)
    }
    const win = getLastFocusedWindow()
    if (win) {
      win.show()
      win.focus()
    }
  })

  app.on("open-url", (event, url: string) => {
    event.preventDefault()
    logger.log("deep link received via open-url", { url })
    emitDeepLinks([url])
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
  app.setAsDefaultProtocolClient(APP_PROTOCOL)
  registerRendererProtocol()
  setDockIcon()

  const updater = setupAutoUpdater()
  const menuDeps = {
    trigger: (id: string) => {
      const win = getLastFocusedWindow()
      if (win) sendMenuCommand(win, id)
    },
    checkForUpdates: () => void showUpdaterDialog(updater, true),
    relaunch,
  }

  registerIpcHandlers({
    relaunch,
    consumeInitialDeepLinks: () => pendingDeepLinks.splice(0),
    updater,
    showUpdater: () => showUpdaterDialog(updater, true),
    setBackgroundColor: (color) => setBackgroundColor(color),
    exportDebugLogs: () => exportDebugLogs(),
    recordFatalRendererError: (error) => writeLog("renderer", "fatal renderer error", { ...error }, "error"),
    setNativeTranslations: (bundle) => {
      if (setNativeTranslations(bundle)) createMenu(menuDeps)
    },
  })

  void updater.start()
  const updateTimer = setInterval(() => void updater.check(), 10 * 60 * 1000)
  updateTimer.unref()
  app.once("will-quit", () => clearInterval(updateTimer))

  app.on("window-all-closed", () => {
    if (process.platform === "darwin") return
    app.quit()
  })
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length > 0) return
    restoreMainWindows()
  })

  const windows = restoreMainWindows()
  if (windows.length) createMenu(menuDeps)
}

void main().catch((error) => {
  console.error(error)
  app.quit()
})
