import type { DesktopNativeKey } from "../../../app/src/i18n/desktop-native"

export type DesktopMenuPlatform = "macos" | "windows"

export type DesktopMenuAction =
  | "app.checkForUpdates"
  | "app.relaunch"
  | "edit.undo"
  | "edit.redo"
  | "edit.cut"
  | "edit.copy"
  | "edit.paste"
  | "edit.delete"
  | "edit.selectAll"
  | "view.reload"
  | "view.toggleDevTools"
  | "view.resetZoom"
  | "view.zoomIn"
  | "view.zoomOut"
  | "view.toggleFullscreen"
  | "window.new"
  | "window.close"
  | "window.minimize"
  | "window.toggleMaximize"

export type DesktopMenuRole =
  | "about"
  | "close"
  | "copy"
  | "cut"
  | "hide"
  | "hideOthers"
  | "paste"
  | "quit"
  | "redo"
  | "reload"
  | "resetZoom"
  | "selectAll"
  | "toggleDevTools"
  | "togglefullscreen"
  | "undo"
  | "unhide"
  | "windowMenu"
  | "zoomIn"
  | "zoomOut"

export type DesktopMenuItem = {
  type: "item"
  labelKey?: DesktopNativeKey
  label?: string
  command?: string
  action?: DesktopMenuAction
  role?: DesktopMenuRole
  href?: string
  accelerator?: Partial<Record<DesktopMenuPlatform, string>>
  enabled?: "updater"
  platforms?: DesktopMenuPlatform[]
}

export type DesktopMenuSeparator = {
  type: "separator"
  platforms?: DesktopMenuPlatform[]
}

export type DesktopMenuEntry = DesktopMenuItem | DesktopMenuSeparator

export type DesktopMenu = {
  id: string
  labelKey?: DesktopNativeKey
  label?: string
  role?: DesktopMenuRole
  items?: DesktopMenuEntry[]
  platforms?: DesktopMenuPlatform[]
}

export const DESKTOP_MENU: DesktopMenu[] = [
  {
    id: "app",
    labelKey: "desktop.menu.app",
    platforms: ["macos"],
    items: [
      { type: "item", role: "about" },
      {
        type: "item",
        labelKey: "desktop.menu.checkForUpdates",
        action: "app.checkForUpdates",
        enabled: "updater",
      },
      { type: "item", labelKey: "desktop.menu.reloadWebview", action: "view.reload" },
      { type: "item", labelKey: "desktop.menu.restart", action: "app.relaunch" },
      { type: "item", labelKey: "desktop.menu.exportLogs", command: "logs.export" },
      { type: "separator" },
      { type: "item", role: "hide" },
      { type: "item", role: "hideOthers" },
      { type: "item", role: "unhide" },
      { type: "separator" },
      { type: "item", role: "quit" },
    ],
  },
  {
    id: "file",
    labelKey: "desktop.menu.file",
    items: [
      {
        type: "item",
        label: "Scan Folder…",
        command: "disk.chooseFolder",
        accelerator: { macos: "Cmd+O", windows: "Ctrl+O" },
      },
      {
        type: "item",
        labelKey: "desktop.menu.newWindow",
        action: "window.new",
        accelerator: { macos: "Cmd+Shift+N", windows: "Ctrl+Shift+N" },
      },
      { type: "separator" },
      { type: "item", labelKey: "desktop.menu.closeWindow", action: "window.close", role: "close" },
    ],
  },
  {
    id: "edit",
    labelKey: "desktop.menu.edit",
    items: [
      { type: "item", labelKey: "desktop.menu.undo", action: "edit.undo", role: "undo", accelerator: { windows: "Ctrl+Z" } },
      { type: "item", labelKey: "desktop.menu.redo", action: "edit.redo", role: "redo", accelerator: { windows: "Ctrl+Y" } },
      { type: "separator" },
      { type: "item", labelKey: "desktop.menu.cut", action: "edit.cut", role: "cut", accelerator: { windows: "Ctrl+X" } },
      { type: "item", labelKey: "desktop.menu.copy", action: "edit.copy", role: "copy", accelerator: { windows: "Ctrl+C" } },
      { type: "item", labelKey: "desktop.menu.paste", action: "edit.paste", role: "paste", accelerator: { windows: "Ctrl+V" } },
      { type: "item", labelKey: "desktop.menu.selectAll", action: "edit.selectAll", role: "selectAll", accelerator: { windows: "Ctrl+A" } },
    ],
  },
  {
    id: "view",
    labelKey: "desktop.menu.view",
    items: [
      { type: "item", labelKey: "desktop.menu.reload", action: "view.reload", role: "reload" },
      { type: "item", labelKey: "desktop.menu.toggleDeveloperTools", action: "view.toggleDevTools", role: "toggleDevTools" },
      { type: "separator" },
      { type: "item", labelKey: "desktop.menu.actualSize", action: "view.resetZoom", role: "resetZoom", accelerator: { windows: "Ctrl+0" } },
      { type: "item", labelKey: "desktop.menu.zoomIn", action: "view.zoomIn", role: "zoomIn", accelerator: { windows: "Ctrl++" } },
      { type: "item", labelKey: "desktop.menu.zoomOut", action: "view.zoomOut", role: "zoomOut", accelerator: { windows: "Ctrl+-" } },
      { type: "separator" },
      { type: "item", labelKey: "desktop.menu.toggleFullScreen", action: "view.toggleFullscreen", role: "togglefullscreen" },
    ],
  },
  {
    id: "window",
    labelKey: "desktop.menu.window",
    role: "windowMenu",
    items: [
      { type: "item", labelKey: "desktop.menu.minimize", action: "window.minimize" },
      { type: "item", labelKey: "desktop.menu.maximize", action: "window.toggleMaximize" },
      { type: "separator" },
      { type: "item", labelKey: "desktop.menu.closeWindow", action: "window.close" },
    ],
  },
  {
    id: "help",
    labelKey: "desktop.menu.help",
    items: [
      { type: "item", label: "DiskLizard on GitHub", href: "https://github.com/bernaferrari/disklizard" },
      { type: "item", labelKey: "desktop.menu.exportLogs", command: "logs.export" },
    ],
  },
]

export function desktopMenuVisible(item: { platforms?: DesktopMenuPlatform[] }, platform: DesktopMenuPlatform) {
  return !item.platforms || item.platforms.includes(platform)
}

export function desktopMenuHasOpenCodeCommands(menu: readonly DesktopMenu[] = DESKTOP_MENU) {
  return menu.some((section) =>
    section.items?.some((item) => item.type === "item" && (item.command?.startsWith("session.") || item.command?.startsWith("project."))),
  )
}
