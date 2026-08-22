import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { chooseFolderAndScan, DISK_CHOOSE_FOLDER_COMMAND, scanFolderLabel } from "./choose-folder"
import type { DiskDriveInfo } from "./types"

const volume: DiskDriveInfo = {
  path: "/Users/me",
  name: "Macintosh HD",
  label: "Macintosh HD",
  total: 1_000,
  free: 400,
  used: 600,
  type: "local",
}

describe("chooseFolderAndScan", () => {
  test("opens the native folder picker and starts a scan of the chosen path", async () => {
    const started: Array<{ path: string; label: string; drive?: DiskDriveInfo }> = []
    await chooseFolderAndScan({
      chooseFolder: async () => "/Users/me/Projects/disklizard",
      startScan: (path, label, drive) => {
        started.push({ path, label, drive })
      },
      drives: [volume],
      os: "macos",
    })
    expect(started).toEqual([
      {
        path: "/Users/me/Projects/disklizard",
        label: "disklizard",
        drive: volume,
      },
    ])
  })

  test("does not start a scan when the picker is cancelled", async () => {
    let started = 0
    await chooseFolderAndScan({
      chooseFolder: async () => null,
      startScan: () => {
        started += 1
      },
      drives: [volume],
    })
    expect(started).toBe(0)
  })

  test("uses the last native path segment as the scan label", () => {
    expect(scanFolderLabel("/Users/me/Projects/app")).toBe("app")
    expect(scanFolderLabel("C:\\Users\\me\\Work")).toBe("Work")
  })

  test("the storage page registers File → Scan Folder onto the same chooseFolder+startScan helper", () => {
    const page = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "index.tsx"), "utf8")
    expect(page).toContain(`register(${"DISK_CHOOSE_FOLDER_COMMAND"}`)
    expect(page).toContain("chooseFolderAndScan")
    expect(page).toContain("chooseAndScan")
    expect(DISK_CHOOSE_FOLDER_COMMAND).toBe("disk.chooseFolder")
  })
})
