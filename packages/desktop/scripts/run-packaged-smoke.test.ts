import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import {
  artifactExecutionMode,
  findDistributableArtifact,
  findPackagedExecutable,
  findOwnedWindowsRecycleEntry,
  findWindowsInstalledProgram,
  packagedLaunchOptions,
  validatePackagedSmokeReport,
} from "./run-packaged-smoke"
import { packagedSmokeEnvironment } from "./packaged-smoke-environment"

const temporaryDirectories: string[] = []

async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(tmpdir(), "disklizard-packaged-runner-test-"))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("packaged product discovery", () => {
  test("locates macOS, Windows, and Linux electron-builder application outputs", async () => {
    const dist = await temporaryDirectory()
    const mac = path.join(dist, "mac-arm64", "DiskLizard Dev.app", "Contents", "MacOS", "DiskLizard Dev")
    const windows = path.join(dist, "win-unpacked", "DiskLizard Dev.exe")
    const linux = path.join(dist, "linux-unpacked", "io.github.bernaferrari.disklizard.dev")
    await Promise.all([mkdir(path.dirname(mac), { recursive: true }), mkdir(path.dirname(windows)), mkdir(path.dirname(linux))])
    await Promise.all([writeFile(mac, ""), writeFile(windows, ""), writeFile(linux, "")])

    expect(await findPackagedExecutable(dist, "darwin")).toBe(mac)
    expect(await findPackagedExecutable(dist, "win32")).toBe(windows)
    expect(await findPackagedExecutable(dist, "linux")).toBe(linux)
  })

  test("requires a real distributable in addition to the unpacked application", async () => {
    const dist = await temporaryDirectory()
    const artifacts = {
      darwin: path.join(dist, "disklizard-mac-arm64.zip"),
      win32: path.join(dist, "disklizard-win-x64.exe"),
      linux: path.join(dist, "disklizard-linux-x64.AppImage"),
    } as const
    await Promise.all(Object.values(artifacts).map((artifact) => writeFile(artifact, "distributable")))

    await expect(findDistributableArtifact(dist, "darwin")).resolves.toMatchObject({
      path: artifacts.darwin,
      format: "zip",
      bytes: 13,
    })
    await expect(findDistributableArtifact(dist, "win32")).resolves.toMatchObject({
      path: artifacts.win32,
      format: "nsis",
      bytes: 13,
    })
    await expect(findDistributableArtifact(dist, "linux")).resolves.toMatchObject({
      path: artifacts.linux,
      format: "appimage",
      bytes: 13,
    })
  })

  test("executes the product from each platform's distributable rather than builder staging", () => {
    expect(artifactExecutionMode("darwin")).toBe("zip-extracted")
    expect(artifactExecutionMode("linux")).toBe("appimage-extract-and-run")
    expect(artifactExecutionMode("win32")).toBe("nsis-installed")
  })

  test("fails closed when stale unpacked or distributable outputs are ambiguous", async () => {
    const dist = await temporaryDirectory()
    for (const architecture of ["arm64", "x64"]) {
      const executable = path.join(dist, `linux-${architecture}-unpacked`, "io.github.bernaferrari.disklizard.dev")
      await mkdir(path.dirname(executable), { recursive: true })
      await writeFile(executable, "")
      await writeFile(path.join(dist, `disklizard-linux-${architecture}.AppImage`), "artifact")
    }
    await expect(findPackagedExecutable(dist, "linux")).rejects.toThrow("Multiple packaged DiskLizard executables")
    await expect(findDistributableArtifact(dist, "linux")).rejects.toThrow("Multiple DiskLizard distributables")
  })

  test("selects the top-level installed app without mistaking its native scanner for it", async () => {
    const install = await temporaryDirectory()
    const app = path.join(install, "DiskLizard Dev.exe")
    const uninstaller = path.join(install, "Uninstall DiskLizard Dev.exe")
    const scanner = path.join(install, "resources", "native", "disklizard-scanner.exe")
    await mkdir(path.dirname(scanner), { recursive: true })
    await Promise.all([writeFile(app, "app"), writeFile(uninstaller, "uninstaller"), writeFile(scanner, "scanner")])

    await expect(findWindowsInstalledProgram(install, false)).resolves.toBe(app)
    await expect(findWindowsInstalledProgram(install, true)).resolves.toBe(uninstaller)
  })

  test("identifies only the smoke-owned Windows Recycle Bin payload and metadata", async () => {
    const recycle = await temporaryDirectory()
    const owner = path.join(recycle, "S-1-5-test")
    await mkdir(owner)
    await Promise.all([
      writeFile(path.join(owner, "$RABC.txt"), "owned marker"),
      writeFile(path.join(owner, "$IABC.txt"), "metadata"),
      writeFile(path.join(owner, "$ROTHER.txt"), "someone else's file"),
      writeFile(path.join(owner, "$IOTHER.txt"), "metadata"),
    ])
    await expect(findOwnedWindowsRecycleEntry(recycle, "owned marker")).resolves.toEqual({
      contentPath: path.join(owner, "$RABC.txt"),
      metadataPath: path.join(owner, "$IABC.txt"),
    })
  })
})

describe("packaged smoke runner contract", () => {
  test("strips release authority and forces a dev smoke identity", () => {
    expect(
      packagedSmokeEnvironment({
        DISKLIZARD_CHANNEL: "prod",
        DISKLIZARD_RELEASE_PUBLIC: "true",
        DISKLIZARD_RELEASE_REPO: "releases",
        DISKLIZARD_SCANNER_PATH: "/tmp/fake-sidecar",
        DISKLIZARD_WINDOWS_PUBLISHER_NAME: "DiskLizard",
        DISKLIZARD_NATIVE_SCANNER: "0",
        ELECTRON_RUN_AS_NODE: "1",
        GH_TOKEN: "github-secret",
        GITHUB_TOKEN: "actions-secret",
        CSC_LINK: "certificate",
        NODE_OPTIONS: "--require=/tmp/injected.js",
      }),
    ).toEqual({
      DISKLIZARD_CHANNEL: "dev",
      OPENCODE_CHANNEL: "dev",
      DISKLIZARD_PACKAGED_SMOKE: "1",
      CSC_IDENTITY_AUTO_DISCOVERY: "false",
    })
  })

  test("builds and packages one smoke identity before exercising the packaged UI", async () => {
    const packageJson: unknown = JSON.parse(await readFile(path.resolve(import.meta.dir, "../package.json"), "utf8"))
    expect(packageJson).toMatchObject({
      scripts: {
        "build:packaged-smoke": "bun ./scripts/build-packaged-smoke.ts",
        "package:smoke": "bun ./scripts/packaged-smoke-pipeline.ts --package-only",
        "verify:packaged-smoke": "bun ./scripts/packaged-smoke-pipeline.ts",
        "smoke:packaged": "tsx ./scripts/run-packaged-smoke.ts",
      },
    })
  })

  test("launches only the smoke-gated fixture and requires the native scanner", () => {
    const options = packagedLaunchOptions("/Applications/DiskLizard", "/work/fixture", "/work/profile", "linux", {
      DISPLAY: ":99",
      DISKLIZARD_CHANNEL: "prod",
      GH_TOKEN: "release-secret",
      CSC_LINK: "certificate",
    })
    expect(options.env.GH_TOKEN).toBeUndefined()
    expect(options.env.CSC_LINK).toBeUndefined()
    expect(options.env.DISKLIZARD_CHANNEL).toBe("dev")
    expect(options).toMatchObject({
      executablePath: "/Applications/DiskLizard",
      args: [
        "--disklizard-packaged-smoke-fixture=/work/fixture",
        "--disklizard-packaged-smoke-user-data=/work/profile",
        "--lang=en-US",
      ],
      env: expect.objectContaining({
        APPIMAGE_EXTRACT_AND_RUN: "1",
        DISKLIZARD_REQUIRE_NATIVE_SCANNER: "1",
        DISPLAY: ":99",
      }),
      chromiumSandbox: true,
    })
  })

  test("validates evidence from the rendered preload and IPC journey", () => {
    const report = {
      schemaVersion: 6,
      journey: "renderer-preload-ipc",
      platform: "darwin",
      artifact: {
        file: "disklizard-mac-arm64.zip",
        format: "zip",
        bytes: 1024,
        archiveEntries: 3_761,
        execution: "zip-extracted",
        unpackedBytes: 350_474_136,
      },
      updateMetadata: {
        file: "latest-mac.yml",
        version: "0.1.0",
        sha512Verified: true,
        blockmapPresent: true,
      },
      firstLaunch: { mapVisible: true, progressObserved: true, progressBeforeMap: true, scanSource: "scan" },
      preview: { textExactContent: true, pdfEmbedded: true },
      relaunch: { mapVisible: true, scanSource: "snapshot" },
      rendererSecurity: { cspErrors: 0 },
      trash: { mapUpdated: true, sourceRemoved: true, destinationVerified: true, integration: "shell.trashItem" },
    } as const
    expect(validatePackagedSmokeReport(report)).toEqual(report)
    expect(() => validatePackagedSmokeReport({ ...report, journey: "main-process-shortcut" })).toThrow(
      "invalid smoke report",
    )
    expect(() =>
      validatePackagedSmokeReport({
        ...report,
        trash: { ...report.trash, sourceRemoved: false },
      }),
    ).toThrow("invalid smoke report")
    expect(() =>
      validatePackagedSmokeReport({
        ...report,
        artifact: { ...report.artifact, bytes: 0 },
      }),
    ).toThrow("invalid smoke report")
    expect(() =>
      validatePackagedSmokeReport({
        ...report,
        artifact: { ...report.artifact, execution: "appimage" },
      }),
    ).toThrow("invalid smoke report")
    expect(() =>
      validatePackagedSmokeReport({
        ...report,
        firstLaunch: { ...report.firstLaunch, progressBeforeMap: false },
      }),
    ).toThrow("invalid smoke report")
    expect(() =>
      validatePackagedSmokeReport({
        ...report,
        rendererSecurity: { cspErrors: 1 },
      }),
    ).toThrow("invalid smoke report")
  })
})
