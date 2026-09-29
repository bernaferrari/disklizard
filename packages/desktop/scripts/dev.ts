import { spawn, execFileSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const environment = { ...process.env }

if (process.platform === "darwin") {
  // app.setName() changes Electron's internal name, but macOS reads the Dock
  // name and app identity from the bundle before our main process starts.
  const electronExecutable = createRequire(import.meta.url)("electron") as string
  const electronBundle = path.resolve(path.dirname(electronExecutable), "../..")
  const electronVersion = createRequire(import.meta.url)("electron/package.json").version as string
  const cacheDir = path.join(packageDir, "node_modules", ".cache", "disklizard-dev-electron")
  const brandedBundle = path.join(cacheDir, `${electronVersion}-${process.arch}`, "DiskLizard Dev.app")
  const brandedExecutable = path.join(brandedBundle, "Contents", "MacOS", "Electron")

  if (!existsSync(brandedExecutable)) {
    mkdirSync(path.dirname(brandedBundle), { recursive: true })
    const temporary = mkdtempSync(path.join(tmpdir(), "disklizard-dev-electron-"))
    const temporaryBundle = path.join(temporary, "DiskLizard Dev.app")
    try {
      execFileSync("ditto", [electronBundle, temporaryBundle], { stdio: "inherit" })
      const plist = path.join(temporaryBundle, "Contents", "Info.plist")
      for (const [key, value] of [
        ["CFBundleName", "DiskLizard Dev"],
        ["CFBundleDisplayName", "DiskLizard Dev"],
        ["CFBundleIdentifier", "io.github.bernaferrari.disklizard.dev"],
        ["CFBundleIconFile", "DiskLizard"],
      ]) {
        execFileSync("plutil", ["-replace", key, "-string", value, plist])
      }
      cpSync(path.join(packageDir, "resources", "icons", "icon.icns"), path.join(temporaryBundle, "Contents", "Resources", "DiskLizard.icns"))
      execFileSync("codesign", ["--force", "--deep", "--sign", "-", temporaryBundle], { stdio: "inherit" })
      renameSync(temporaryBundle, brandedBundle)
    } finally {
      rmSync(temporary, { recursive: true, force: true })
    }
  }
  environment.ELECTRON_EXEC_PATH = brandedExecutable
}

const vite = path.join(packageDir, "node_modules", ".bin", "electron-vite")
const child = spawn(vite, ["dev", ...process.argv.slice(2)], { cwd: packageDir, env: environment, stdio: "inherit" })
child.on("error", (error) => {
  console.error(error)
  process.exitCode = 1
})
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exitCode = code ?? 1
})
