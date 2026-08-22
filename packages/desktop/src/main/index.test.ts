import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const main = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "index.ts"), "utf8")

describe("desktop initialization", () => {
  test("starts the window without waiting on an OpenCode sidecar", () => {
    expect(main).toContain("restoreMainWindows")
    expect(main).not.toContain("Deferred.await(serverReady)")
    expect(main).not.toContain("spawnLocalServer")
    expect(main).not.toContain("startBackgroundCli")
  })
})
