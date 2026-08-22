import { driveForPath } from "./storage"
import type { DiskDriveInfo } from "./types"

export const DISK_CHOOSE_FOLDER_COMMAND = "disk.chooseFolder"

export function scanFolderLabel(path: string) {
  return path.split(/[/\\]/).pop() || path
}

/** Shared by the in-page "Scan a folder" button and File → Scan Folder… / Cmd+O. */
export async function chooseFolderAndScan(input: {
  chooseFolder: () => Promise<string | null>
  startScan: (path: string, label: string, drive?: DiskDriveInfo) => unknown
  drives: readonly DiskDriveInfo[]
  os?: "macos" | "windows" | "linux"
}) {
  const path = await input.chooseFolder()
  if (!path) return
  await input.startScan(path, scanFolderLabel(path), driveForPath(path, input.drives, input.os))
}
