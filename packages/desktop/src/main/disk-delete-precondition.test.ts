import { afterEach, describe, expect, test } from "bun:test"
import { lstat, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { platform, tmpdir } from "node:os"
import { join } from "node:path"
import type { DeveloperArtifactDirectoryIdentity } from "@disklizard/core"
import {
  assertDeveloperArtifactDeletePrecondition,
  runGuardedDiskDelete,
  STALE_DEVELOPER_ARTIFACT_ERROR,
  type DeveloperArtifactDeletePrecondition,
} from "./disk-delete-precondition"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function identity(path: string): Promise<DeveloperArtifactDirectoryIdentity> {
  const info = await lstat(path, { bigint: true })
  return {
    platform: platform() === "win32" ? "windows" : "posix",
    device: info.dev.toString(),
    fileId: info.ino.toString(),
    modifiedAt: Math.floor(Number(info.mtimeMs)),
  }
}

function nodeModulesPrecondition(directoryIdentity?: DeveloperArtifactDirectoryIdentity): DeveloperArtifactDeletePrecondition {
  return {
    kind: "developer-artifact",
    ...(directoryIdentity === undefined ? {} : { directoryIdentity }),
    artifact: {
      name: "node_modules",
      kind: "dependencies",
      ecosystem: "node",
      confidence: "likely",
      cleanup: "review",
    },
  }
}

describe("developer artifact delete precondition", () => {
  test("accepts an unchanged directory with matching direct identity and classifier", async () => {
    const root = await mkdtemp(join(tmpdir(), "disklizard-delete-guard-"))
    roots.push(root)
    const modules = join(root, "project", "node_modules")
    await mkdir(modules, { recursive: true })
    await writeFile(join(modules, "package.js"), "export {}")

    await expect(assertDeveloperArtifactDeletePrecondition(modules, nodeModulesPrecondition(await identity(modules)))).resolves.toBeUndefined()
  })

  test("rejects an identity-less inventory precondition instead of shape-only deletion", async () => {
    const root = await mkdtemp(join(tmpdir(), "disklizard-delete-guard-"))
    roots.push(root)
    const modules = join(root, "project", "node_modules")
    await mkdir(modules, { recursive: true })

    await expect(assertDeveloperArtifactDeletePrecondition(modules, nodeModulesPrecondition())).rejects.toThrow(
      STALE_DEVELOPER_ARTIFACT_ERROR,
    )
  })

  test("rejects a changed direct identity", async () => {
    const root = await mkdtemp(join(tmpdir(), "disklizard-delete-guard-"))
    roots.push(root)
    const modules = join(root, "project", "node_modules")
    await mkdir(modules, { recursive: true })
    const stale = await identity(modules)
    stale.fileId = `${stale.fileId}1`

    await expect(assertDeveloperArtifactDeletePrecondition(modules, nodeModulesPrecondition(stale))).rejects.toThrow(
      STALE_DEVELOPER_ARTIFACT_ERROR,
    )
  })

  test("rejects a file, a symlink, and a directory whose classifier no longer matches", async () => {
    const root = await mkdtemp(join(tmpdir(), "disklizard-delete-guard-"))
    roots.push(root)
    const file = join(root, "node_modules")
    await writeFile(file, "not a directory")
    await expect(assertDeveloperArtifactDeletePrecondition(file, nodeModulesPrecondition())).rejects.toThrow(
      STALE_DEVELOPER_ARTIFACT_ERROR,
    )

    const target = join(root, "project", "target")
    await mkdir(target, { recursive: true })
    const wrongClassifier: DeveloperArtifactDeletePrecondition = {
      kind: "developer-artifact",
      artifact: {
        name: "target",
        kind: "build-output",
        ecosystem: "rust",
        confidence: "verified",
        cleanup: "eligible",
      },
    }
    await expect(assertDeveloperArtifactDeletePrecondition(target, wrongClassifier)).rejects.toThrow(
      STALE_DEVELOPER_ARTIFACT_ERROR,
    )

    if (platform() !== "win32") {
      const real = join(root, "real", "node_modules")
      const alias = join(root, "alias", "node_modules")
      await mkdir(real, { recursive: true })
      await mkdir(join(root, "alias"), { recursive: true })
      await symlink(real, alias, "dir")
      await expect(assertDeveloperArtifactDeletePrecondition(alias, nodeModulesPrecondition())).rejects.toThrow(
        STALE_DEVELOPER_ARTIFACT_ERROR,
      )
    }
  })

  test("runs the fresh artifact proof immediately after the final safe-path check", async () => {
    const root = await mkdtemp(join(tmpdir(), "disklizard-delete-guard-"))
    roots.push(root)
    const modules = join(root, "project", "node_modules")
    await mkdir(modules, { recursive: true })
    const precondition = nodeModulesPrecondition(await identity(modules))
    let operationRan = false

    await expect(
      runGuardedDiskDelete(
        modules,
        precondition,
        async () => {
          // Simulate a replacement that lands after the final safe-path
          // check. The identity proof must reject it before the operation.
          await rm(modules, { recursive: true, force: true })
          await mkdir(modules)
        },
        async () => {
          operationRan = true
        },
      ),
    ).rejects.toThrow(STALE_DEVELOPER_ARTIFACT_ERROR)
    expect(operationRan).toBeFalse()
  })
})
