import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { assertPackagedSmokeFormats, packagedSmokeTargetArguments } from "./packaged-smoke-targets"

const temporary: string[] = []

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("packaged smoke release formats", () => {
  test("builds every configured production format on its native operating system", () => {
    expect(packagedSmokeTargetArguments("darwin")).toEqual(["--mac", "zip", "dmg"])
    expect(packagedSmokeTargetArguments("win32")).toEqual(["--win", "nsis"])
    expect(packagedSmokeTargetArguments("linux")).toEqual(["--linux", "AppImage", "deb", "rpm"])
    expect(() => packagedSmokeTargetArguments("aix")).toThrow("unsupported")
  })

  test("fails unless each Linux release package exists exactly once and is non-empty", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "disklizard-formats-"))
    temporary.push(directory)
    await Promise.all([
      writeFile(path.join(directory, "disklizard-linux-x64.AppImage"), "appimage"),
      writeFile(path.join(directory, "disklizard-linux-x64.deb"), "deb"),
      writeFile(path.join(directory, "disklizard-linux-x64.rpm"), "rpm"),
    ])
    await expect(assertPackagedSmokeFormats(directory, "linux")).resolves.toHaveLength(3)

    await writeFile(path.join(directory, "stale-linux-arm64.deb"), "stale")
    await expect(assertPackagedSmokeFormats(directory, "linux")).rejects.toThrow("exactly one")
  })
})
