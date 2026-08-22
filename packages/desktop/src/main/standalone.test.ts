import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
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

  test("renderer entry mounts the storage utility without the OpenCode application shell", () => {
    const renderer = readFileSync(join(dir, "../renderer/index.tsx"), "utf8")
    const platform = readFileSync(join(dir, "../renderer/platform.ts"), "utf8")
    expect(renderer).toContain("DiskUtilityPage")
    expect(renderer).toContain("DiskLizardRuntime")
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
