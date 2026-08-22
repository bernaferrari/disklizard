import { describe, expect, test } from "bun:test"
import { DISK_CHOOSE_FOLDER_COMMAND } from "./choose-folder"
import { createDiskLizardMenu, DISK_ACCESS_GUIDANCE, diskLanguageText } from "./runtime"

describe("DiskLizard runtime language", () => {
  test("resolves the shipped access-guidance copy", () => {
    expect(diskLanguageText("disk.accessGuidance.rescan")).toBe(DISK_ACCESS_GUIDANCE["disk.accessGuidance.rescan"])
    expect(diskLanguageText("disk.accessGuidance.macos")).toContain("Full Disk Access")
    expect(diskLanguageText("unknown.key")).toBe("unknown.key")
  })

  test("runs the registered Scan Folder handler and forgets it after unbind", async () => {
    const menu = createDiskLizardMenu()
    const runs: string[] = []
    const unbind = menu.register(DISK_CHOOSE_FOLDER_COMMAND, () => {
      runs.push("scan")
    })
    await menu.run(DISK_CHOOSE_FOLDER_COMMAND)
    unbind()
    await menu.run(DISK_CHOOSE_FOLDER_COMMAND)
    expect(runs).toEqual(["scan"])
  })
})
