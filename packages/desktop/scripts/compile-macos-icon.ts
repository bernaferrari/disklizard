import { execFileSync } from "node:child_process"
import { mkdtemp, copyFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

/** Compile Icon Composer appearances into the signed bundle's resource catalog. */
export async function compileMacosIcon(appPath: string, projectDir: string) {
  const temporary = await mkdtemp(path.join(tmpdir(), "disklizard-icon-"))
  try {
    execFileSync("xcrun", [
      "actool",
      path.join(projectDir, "icons/source/DiskLizard.icon"),
      "--compile",
      temporary,
      "--platform",
      "macosx",
      "--minimum-deployment-target",
      "13.0",
      "--app-icon",
      "DiskLizard",
      "--output-partial-info-plist",
      path.join(temporary, "info.plist"),
    ])
    for (const name of ["Assets.car", "DiskLizard.icns"]) {
      await copyFile(path.join(temporary, name), path.join(appPath, "Contents/Resources", name))
    }
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}
