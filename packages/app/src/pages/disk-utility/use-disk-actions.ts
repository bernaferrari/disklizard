import { showToast } from "@/components/dl/toast"
import { useLanguage, usePlatform } from "./runtime"
import { nativeTrashName } from "./navigation"

/** Native commands own their user-facing failures and updater feedback. */
export function useDiskActions() {
  const platform = usePlatform()
  const language = useLanguage()
  const disk = platform.diskUtility
  async function reveal(path: string) {
    const api = disk
    if (!api) return
    try {
      await api.revealPath(path)
    } catch (err) {
      showToast({
        variant: "error",
        title: language.t("disk.toast.revealFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
    }
  }

  async function openTrash() {
    const api = disk
    if (!api) return
    try {
      await api.openTrash()
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t("disk.toast.trashOpenFailed", {
          trash: nativeTrashName(platform.os),
        }),
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }

  async function handleUpdaterMenuAction() {
    const updater = platform.updater
    if (!updater) return
    try {
      const current = updater.state
      if (current.status === "ready") {
        await updater.install()
        return
      }
      const next = await updater.check()
      if (next.status === "ready") {
        showToast({
          variant: "success",
          title: language.t("disk.app.updateReady"),
          description: language.t("disk.app.updateReadyBody", {
            version: next.version,
          }),
        })
      } else if (next.status === "up-to-date") {
        showToast({
          variant: "success",
          title: language.t("disk.app.upToDate"),
        })
      } else if (next.status === "error") {
        showToast({
          variant: "error",
          title: language.t("disk.app.updateFailed"),
          description: next.message,
        })
      }
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t("disk.app.updateFailed"),
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }

  async function exportDiagnostics() {
    if (!platform.exportDiagnostics) return
    try {
      const path = await platform.exportDiagnostics()
      showToast({
        variant: "success",
        title: language.t("disk.app.diagnosticsSaved"),
        description: language.t("disk.app.diagnosticsSavedBody", { path }),
      })
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t("disk.app.diagnosticsFailed"),
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return { reveal, openTrash, handleUpdaterMenuAction, exportDiagnostics }
}
