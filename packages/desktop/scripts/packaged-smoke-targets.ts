import { readdir, stat } from "node:fs/promises"
import path from "node:path"

export type PackagedSmokePlatform = "darwin" | "linux" | "win32"

export function packagedSmokeTargetArguments(platform: NodeJS.Platform): string[] {
  if (platform === "darwin") return ["--mac", "zip", "dmg"]
  if (platform === "win32") return ["--win", "nsis"]
  if (platform === "linux") return ["--linux", "AppImage", "deb", "rpm"]
  throw new Error(`Packaged smoke is unsupported on ${platform}`)
}

function requiredSuffixes(platform: PackagedSmokePlatform) {
  if (platform === "darwin") return [".zip", ".dmg"]
  if (platform === "linux") return [".appimage", ".deb", ".rpm"]
  return [".exe"]
}

/** Prove every production package format was emitted, not only the UI launch target. */
export async function assertPackagedSmokeFormats(directory: string, platform: PackagedSmokePlatform) {
  const files = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
  const verified: string[] = []
  for (const suffix of requiredSuffixes(platform)) {
    const matches = files.filter((file) => file.toLowerCase().endsWith(suffix))
    if (matches.length !== 1) {
      throw new Error(`Expected exactly one ${platform} ${suffix} package; found ${matches.length}`)
    }
    const file = matches[0]!
    if ((await stat(path.join(directory, file))).size <= 0) {
      throw new Error(`Packaged ${suffix} artifact is empty`)
    }
    verified.push(file)
  }
  return verified
}
