#!/usr/bin/env bun
import { rm } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { inspectPackagedBoundary } from "./inspect-packaged-boundary"
import { packagedSmokeEnvironment } from "./packaged-smoke-environment"
import { assertPackagedSmokeFormats, packagedSmokeTargetArguments } from "./packaged-smoke-targets"
import { verifyPackagedReleaseArchives, writePackageArchiveEvidence } from "./verify-package-archives"
import { verifyElectronUpdaterMetadata } from "./verify-update-metadata"
import { APP_IDS, APP_NAMES } from "../src/main/product-identity"

const desktopDirectory = fileURLToPath(new URL("..", import.meta.url))
const workspaceDirectory = path.resolve(desktopDirectory, "../..")
const distDirectory = path.join(desktopDirectory, "dist-smoke")
const archiveEvidencePath = path.join(workspaceDirectory, "test-results", `packaged-archives-${process.platform}.json`)
await rm(distDirectory, { recursive: true, force: true })
await rm(archiveEvidencePath, { force: true })

const target = packagedSmokeTargetArguments(process.platform)

// Smoke packaging is the only mode that suppresses release signing and macOS
// notarization. It still builds a real installable/distributable target plus
// electron-builder's unpacked staging application for Playwright Electron.
const packageProcess = Bun.spawn(
  [process.execPath, "x", "electron-builder", ...target, "--publish", "never", "--config", "electron-builder.config.ts"],
  {
    cwd: desktopDirectory,
    env: packagedSmokeEnvironment(process.env),
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  },
)

const status = await packageProcess.exited
if (status !== 0) process.exit(status)
await inspectPackagedBoundary(distDirectory)
if (process.platform !== "darwin" && process.platform !== "linux" && process.platform !== "win32") {
  throw new Error(`Packaged smoke is unsupported on ${process.platform}`)
}
await assertPackagedSmokeFormats(distDirectory, process.platform)
const desktopPackage = (await Bun.file(path.join(desktopDirectory, "package.json")).json()) as { version?: unknown }
if (typeof desktopPackage.version !== "string") throw new Error("Desktop package version is missing")
const archiveEvidence = await verifyPackagedReleaseArchives(
  distDirectory,
  process.platform,
  { appId: APP_IDS.dev, productName: APP_NAMES.dev },
  { packageName: "disklizard-dev", version: desktopPackage.version, architecture: process.arch },
)
await verifyElectronUpdaterMetadata(distDirectory, process.platform, desktopPackage.version)
if (archiveEvidence) {
  await writePackageArchiveEvidence(archiveEvidence, archiveEvidencePath)
  console.log(`[disklizard] package archives passed: ${archiveEvidence.packages.map((item) => item.format).join(", ")}`)
}
