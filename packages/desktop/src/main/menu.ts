import { BrowserWindow, Menu } from "electron"
import type { MenuItemConstructorOptions } from "electron"
import { DESKTOP_MENU, desktopMenuVisible, type DesktopMenuEntry, type DesktopMenuItem, type DesktopMenuRole } from "./desktop-menu"

import { UPDATER_ENABLED } from "./constants"
import { runDesktopMenuAction } from "./desktop-menu-actions"
import { openExternalURL } from "./windows"
import { nativeT } from "./native-translations"

type Deps = {
  trigger: (id: string) => void
  checkForUpdates: () => void
  relaunch: () => void
}

export function createMenu(deps: Deps) {
  const platform =
    process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : undefined
  if (!platform) return

  const template = DESKTOP_MENU.filter(
    (menu) =>
      desktopMenuVisible(menu, platform) &&
      // Electron restricts these roles to macOS; drop them rather than ship
      // dead items in the Windows/Linux menu bar.
      (platform === "macos" || menu.role === undefined || !(menu.role in MACOS_ONLY_ROLES)),
  ).map((menu) => {
    if (menu.role) {
      return { role: nativeRole(menu.role), label: menu.label ?? (menu.labelKey ? nativeT(menu.labelKey) : undefined) }
    }
    return {
      label: menu.label ?? (menu.labelKey ? nativeT(menu.labelKey) : undefined),
      submenu: menu.items
        ?.filter(
          (entry): entry is DesktopMenuItem =>
            desktopMenuVisible(entry, platform) &&
            entry.type !== "separator" &&
            (platform === "macos" || entry.role === undefined || !(entry.role in MACOS_ONLY_ROLES)),
        )
        .map((entry) => nativeItem(entry, deps, platform)),
    }
  })

  // Frameless windows keep this menu bar invisible while its accelerators
  // (e.g. File → Scan Folder… Ctrl+O) stay live.
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function nativeItem(
  entry: DesktopMenuEntry,
  deps: Deps,
  platform: "macos" | "windows",
): MenuItemConstructorOptions {
  if (entry.type === "separator") return { type: "separator" }
  if (entry.role) {
    return { role: nativeRole(entry.role), label: entry.labelKey ? nativeT(entry.labelKey) : undefined }
  }

  const item: MenuItemConstructorOptions = {
    label: entry.label ?? (entry.labelKey ? nativeT(entry.labelKey) : undefined),
    accelerator: entry.accelerator?.[platform],
    enabled: entry.enabled === "updater" ? UPDATER_ENABLED : undefined,
  }

  if (entry.command) {
    const command = entry.command
    item.click = () => deps.trigger(command)
  }
  if (entry.action) {
    const action = entry.action
    item.click = () =>
      runDesktopMenuAction(BrowserWindow.getFocusedWindow(), action, {
        checkForUpdates: deps.checkForUpdates,
        relaunch: deps.relaunch,
      })
  }
  if (entry.href) {
    const href = entry.href
    item.click = () => openExternalURL(href)
  }

  return item
}

function nativeRole(role: DesktopMenuRole) {
  return role as NonNullable<MenuItemConstructorOptions["role"]>
}

/** Electron restricts these roles to macOS; they are dropped elsewhere. */
const MACOS_ONLY_ROLES: Record<string, true> = {
  hide: true,
  hideOthers: true,
  unhide: true,
  windowMenu: true,
}
