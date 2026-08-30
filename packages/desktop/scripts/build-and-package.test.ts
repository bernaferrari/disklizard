import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { packageEnvironment } from "./build-and-package"

describe("atomic desktop packaging", () => {
  test("freezes one resolved channel across build and package subprocesses", () => {
    const source = { DISKLIZARD_CHANNEL: "prod", OPENCODE_CHANNEL: "beta", KEEP: "value" }
    const environment = packageEnvironment(source)
    source.DISKLIZARD_CHANNEL = "dev"

    expect(environment).toEqual({ DISKLIZARD_CHANNEL: "prod", OPENCODE_CHANNEL: "prod", KEEP: "value" })
    expect(packageEnvironment({ DISKLIZARD_CHANNEL: "invalid" })).toMatchObject({
      DISKLIZARD_CHANNEL: "dev",
      OPENCODE_CHANNEL: "dev",
    })
  })

  test("routes every user-facing package command through an atomic builder", async () => {
    const manifest = JSON.parse(await readFile(path.resolve(import.meta.dir, "../package.json"), "utf8")) as {
      scripts?: Record<string, string>
    }
    expect(manifest.scripts).toMatchObject({
      package: "bun ./scripts/build-and-package.ts",
      "package:dir": "bun ./scripts/build-and-package.ts --dir",
      "package:mac": "bun ./scripts/build-and-package.ts --mac",
      "package:win": "bun ./scripts/build-and-package.ts --win",
      "package:linux": "bun ./scripts/build-and-package.ts --linux",
      "package:smoke": "bun ./scripts/packaged-smoke-pipeline.ts --package-only",
      "verify:packaged-smoke": "bun ./scripts/packaged-smoke-pipeline.ts",
    })
  })
})
