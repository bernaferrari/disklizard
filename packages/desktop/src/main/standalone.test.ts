import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { desktopMenuHasOpenCodeCommands } from "./desktop-menu"
import { productionUpdaterDowngradeAllowed, productionVerifyUpdateCodeSignature } from "./updater-policy"

const dir = dirname(fileURLToPath(import.meta.url))

function source(relative: string) {
  return readFileSync(join(dir, relative), "utf8")
}

describe("DiskLizard standalone desktop runtime", () => {
  test("main process does not start an OpenCode sidecar, WSL, or draft store", () => {
    const main = source("index.ts")
    const ipc = source("ipc.ts")
    expect(main).not.toMatch(/spawnLocalServer|startBackgroundCli|createWslServersController|registerWslIpcHandlers/)
    expect(main).not.toMatch(/AppInterface|ServerConnection|awaitInitialization/)
    expect(ipc).not.toMatch(/createDesktopDraftStore|kill-sidecar|await-initialization|wsl-servers/)
    expect(ipc).not.toMatch(/draft-get|draft-set|get-default-server-url/)
  })

  test("does not retain disconnected OpenCode desktop subsystems or PTY binaries", () => {
    const packageRoot = join(dir, "../..")
    const legacyPaths = [
      "src/main/background-cli.ts",
      "src/main/draft-store.ts",
      "src/main/server.ts",
      "src/main/shell-env.ts",
      "src/main/sidecar.ts",
      "src/main/wsl/ipc.ts",
      "src/main/wsl/policy.ts",
      "src/main/wsl/runtime.ts",
      "src/main/wsl/servers.ts",
      "src/main/wsl/sidecar.ts",
      "src/main/wsl/startup.ts",
      "src/renderer/wsl/connections.ts",
    ]
    for (const relative of legacyPaths) expect(existsSync(join(packageRoot, relative))).toBe(false)

    const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>
      optionalDependencies?: Record<string, string>
    }
    expect(manifest.dependencies).not.toHaveProperty("drizzle-orm")
    expect(Object.keys(manifest.optionalDependencies ?? {}).some((name) => name.includes("node-pty"))).toBe(false)

    const scriptUtils = readFileSync(join(packageRoot, "scripts/utils.ts"), "utf8")
    expect(scriptUtils).not.toMatch(/prepareServerBundle|downloadCliToResources|@opencode-ai\/cli/)
  })

  test("macOS window leaves room for traffic lights and a draggable titlebar", () => {
    const windows = source("windows.ts")
    const styles = readFileSync(join(dir, "../../../app/src/pages/disk-utility/styles.ts"), "utf8")
    const page = readFileSync(join(dir, "../../../app/src/pages/disk-utility/index.tsx"), "utf8")
    expect(windows).toMatch(/trafficLightPosition:\s*\{\s*x:\s*16,\s*y:\s*22\s*\}/)
    expect(styles).toContain("MAC_TRAFFIC_LIGHT_INSET")
    expect(styles).toContain("-webkit-app-region: drag")
    expect(page).toContain("data-tauri-drag-region")
    expect(page).toContain("data-os={platform.os}")
  })

  test("renderer entry mounts the storage utility without the OpenCode application shell", () => {
    const renderer = readFileSync(join(dir, "../renderer/index.tsx"), "utf8")
    const platform = readFileSync(join(dir, "../renderer/platform.ts"), "utf8")
    expect(renderer).toContain("DiskUtilityPage")
    expect(renderer).toContain("DiskLizardRuntime")
    expect(renderer).toContain("handleRendererMenuCommand")
    expect(renderer).toContain("rendererMenuHandlers")
    expect(renderer).not.toMatch(/AppInterface|ServerConnection|useWslServers|createDraftStore|DesktopFirstLaunchOnboarding/)
    expect(platform).not.toMatch(/ServerConnection|wslServers|draftStore|getDefaultServer|killSidecar/)
  })

  test("preload no longer exposes sidecar, WSL, or draft APIs", () => {
    const preload = readFileSync(join(dir, "../preload/index.ts"), "utf8")
    expect(preload).toContain("disklizard")
    expect(preload).not.toMatch(/killSidecar|awaitInitialization|wslServers|draftGet|getDefaultServerUrl/)
  })

  test("native menu has no session or project commands", () => {
    expect(desktopMenuHasOpenCodeCommands()).toBe(false)
  })

  test("production updates verify signatures and refuse downgrades", () => {
    expect(productionVerifyUpdateCodeSignature()).toBe(true)
    expect(productionUpdaterDowngradeAllowed("prod")).toBe(false)
    expect(productionUpdaterDowngradeAllowed("beta")).toBe(true)
    expect(productionUpdaterDowngradeAllowed("dev")).toBe(true)
  })
})
