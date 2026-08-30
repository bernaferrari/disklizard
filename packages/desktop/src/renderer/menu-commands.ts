import { DISK_CHOOSE_FOLDER_COMMAND } from "@disklizard/app/choose-folder"
import type { DiskLizardMenu } from "@disklizard/app/runtime"

export type RendererMenuHandlers = {
  resetZoom: () => unknown
  zoomIn: () => unknown
  zoomOut: () => unknown
  exportLogs: () => unknown
  chooseFolder: () => unknown
  runDesktopMenuAction: (id: string) => unknown
}

export function rendererMenuHandlers(input: {
  resetZoom: () => unknown
  zoomIn: () => unknown
  zoomOut: () => unknown
  exportLogs: () => unknown
  menu?: DiskLizardMenu
  runDesktopMenuAction: (id: string) => unknown
}): RendererMenuHandlers {
  return {
    resetZoom: input.resetZoom,
    zoomIn: input.zoomIn,
    zoomOut: input.zoomOut,
    exportLogs: input.exportLogs,
    chooseFolder: () => input.menu?.run(DISK_CHOOSE_FOLDER_COMMAND),
    runDesktopMenuAction: input.runDesktopMenuAction,
  }
}

/** Every native menu command the standalone renderer is responsible for. */
export function handleRendererMenuCommand(id: string, handlers: RendererMenuHandlers) {
  switch (id) {
    case "view.resetZoom":
      return handlers.resetZoom()
    case "view.zoomIn":
      return handlers.zoomIn()
    case "view.zoomOut":
      return handlers.zoomOut()
    case "logs.export":
      return handlers.exportLogs()
    case DISK_CHOOSE_FOLDER_COMMAND:
      return handlers.chooseFolder()
    default:
      return handlers.runDesktopMenuAction(id)
  }
}
