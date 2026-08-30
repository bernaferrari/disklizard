import { describe, expect, test } from "bun:test"
import { chooseFolderAndScan, DISK_CHOOSE_FOLDER_COMMAND } from "@disklizard/app/choose-folder"
import { createDiskLizardMenu } from "@disklizard/app/runtime"
import { DESKTOP_MENU } from "../main/desktop-menu"
import { handleRendererMenuCommand, rendererMenuHandlers } from "./menu-commands"
import type { DiskDriveInfo } from "@disklizard/app/types"

const volume: DiskDriveInfo = {
  path: "/Users/me",
  name: "Macintosh HD",
  label: "Macintosh HD",
  total: 1_000,
  free: 400,
  used: 600,
  type: "local",
}

describe("standalone File → Scan Folder menu command", () => {
  test("is the File menu command shipped to the native menu", () => {
    const file = DESKTOP_MENU.find((menu) => menu.id === "file")
    const scan = file?.items?.find((item) => item.type === "item" && item.command === DISK_CHOOSE_FOLDER_COMMAND)
    expect(scan).toMatchObject({ labelKey: "desktop.dialog.chooseFolder" })
    expect(scan).not.toHaveProperty("label")
    expect(file?.items?.some((item) => item.type === "item" && item.action === "window.new")).toBe(false)
  })

  test("runs the page chooseFolder+startScan path instead of falling through to desktop menu actions", async () => {
    const menu = createDiskLizardMenu()
    const picked: string[] = []
    const started: Array<{ path: string; label: string; drive?: DiskDriveInfo }> = []
    let fellThrough: string | undefined

    menu.register(DISK_CHOOSE_FOLDER_COMMAND, () =>
      chooseFolderAndScan({
        chooseFolder: async () => {
          picked.push("/Users/me/Projects/disklizard")
          return "/Users/me/Projects/disklizard"
        },
        startScan: (path, label, drive) => {
          started.push({ path, label, drive })
        },
        drives: [volume],
        os: "macos",
      }),
    )

    await handleRendererMenuCommand(
      DISK_CHOOSE_FOLDER_COMMAND,
      rendererMenuHandlers({
        resetZoom: () => undefined,
        zoomIn: () => undefined,
        zoomOut: () => undefined,
        exportLogs: () => undefined,
        menu,
        runDesktopMenuAction: (id) => {
          fellThrough = id
        },
      }),
    )

    expect(fellThrough).toBeUndefined()
    expect(picked).toEqual(["/Users/me/Projects/disklizard"])
    expect(started).toEqual([
      { path: "/Users/me/Projects/disklizard", label: "disklizard", drive: volume },
    ])
  })

  test("does not start a scan when the native picker is cancelled", async () => {
    const menu = createDiskLizardMenu()
    let started = 0
    menu.register(DISK_CHOOSE_FOLDER_COMMAND, () =>
      chooseFolderAndScan({
        chooseFolder: async () => null,
        startScan: () => {
          started += 1
        },
        drives: [volume],
      }),
    )

    await handleRendererMenuCommand(
      DISK_CHOOSE_FOLDER_COMMAND,
      rendererMenuHandlers({
        resetZoom: () => undefined,
        zoomIn: () => undefined,
        zoomOut: () => undefined,
        exportLogs: () => undefined,
        menu,
        runDesktopMenuAction: () => {
          throw new Error("disk.chooseFolder must not fall through")
        },
      }),
    )

    expect(started).toBe(0)
  })
})
