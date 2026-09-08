#!/usr/bin/env node
import { _electron as electron, expect, type Page } from "@playwright/test"
import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { constants as fsConstants } from "node:fs"
import { access, chmod, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import {
  PACKAGED_SMOKE_FIXTURE_ARGUMENT,
  PACKAGED_SMOKE_USER_DATA_ARGUMENT,
} from "../src/main/packaged-smoke"
import { inspectPackagedBoundary } from "./inspect-packaged-boundary"
import { packagedSmokeEnvironment } from "./packaged-smoke-environment"
import { verifyElectronUpdaterMetadata } from "./verify-update-metadata"

type SupportedPlatform = "darwin" | "linux" | "win32"
type ArtifactFormat = "appimage" | "nsis" | "zip"
const scriptPath = fileURLToPath(import.meta.url)
const scriptDirectory = path.dirname(scriptPath)

export type PackagedSmokeReport = {
  schemaVersion: 6
  journey: "renderer-preload-ipc"
  platform: SupportedPlatform
  artifact: {
    file: string
    format: ArtifactFormat
    bytes: number
    archiveEntries: number
    execution: "appimage-extract-and-run" | "nsis-installed" | "zip-extracted"
    unpackedBytes: number
  }
  updateMetadata: {
    file: string
    version: string
    sha512Verified: true
    blockmapPresent: true
  }
  firstLaunch: { mapVisible: true; progressObserved: true; progressBeforeMap: true; scanSource: "scan" }
  preview: { textExactContent: true; pdfEmbedded: true }
  relaunch: { mapVisible: true; scanSource: "snapshot" }
  rendererSecurity: { cspErrors: 0 }
  trash: { mapUpdated: true; sourceRemoved: true; destinationVerified: true; integration: "shell.trashItem" }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function positiveInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
}

export function validatePackagedSmokeReport(value: unknown): PackagedSmokeReport {
  const artifact = isRecord(value) && isRecord(value.artifact) ? value.artifact : undefined
  const updateMetadata = isRecord(value) && isRecord(value.updateMetadata) ? value.updateMetadata : undefined
  const firstLaunch = isRecord(value) && isRecord(value.firstLaunch) ? value.firstLaunch : undefined
  const preview = isRecord(value) && isRecord(value.preview) ? value.preview : undefined
  const relaunch = isRecord(value) && isRecord(value.relaunch) ? value.relaunch : undefined
  const rendererSecurity = isRecord(value) && isRecord(value.rendererSecurity) ? value.rendererSecurity : undefined
  const trash = isRecord(value) && isRecord(value.trash) ? value.trash : undefined
  const platform =
    isRecord(value) && (value.platform === "darwin" || value.platform === "linux" || value.platform === "win32")
      ? value.platform
      : undefined
  const expectedFormat = platform === "darwin" ? "zip" : platform === "linux" ? "appimage" : "nsis"
  if (
    !isRecord(value) ||
    value.schemaVersion !== 6 ||
    value.journey !== "renderer-preload-ipc" ||
    !platform ||
    !artifact ||
    typeof artifact.file !== "string" ||
    artifact.file.length === 0 ||
    artifact.format !== expectedFormat ||
    !positiveInteger(artifact.bytes) ||
    !positiveInteger(artifact.archiveEntries) ||
    artifact.execution !== artifactExecutionMode(platform) ||
    !positiveInteger(artifact.unpackedBytes) ||
    !updateMetadata ||
    typeof updateMetadata.file !== "string" ||
    updateMetadata.file.length === 0 ||
    typeof updateMetadata.version !== "string" ||
    updateMetadata.version.length === 0 ||
    updateMetadata.sha512Verified !== true ||
    updateMetadata.blockmapPresent !== true ||
    !firstLaunch ||
    firstLaunch.mapVisible !== true ||
    firstLaunch.progressObserved !== true ||
    firstLaunch.progressBeforeMap !== true ||
    firstLaunch.scanSource !== "scan" ||
    !preview ||
    preview.textExactContent !== true ||
    preview.pdfEmbedded !== true ||
    !relaunch ||
    relaunch.mapVisible !== true ||
    relaunch.scanSource !== "snapshot" ||
    !rendererSecurity ||
    rendererSecurity.cspErrors !== 0 ||
    !trash ||
    trash.mapUpdated !== true ||
    trash.sourceRemoved !== true ||
    trash.destinationVerified !== true ||
    trash.integration !== "shell.trashItem"
  ) {
    throw new Error("Packaged DiskLizard returned an invalid smoke report")
  }
  return value as PackagedSmokeReport
}

async function unpackedDirectories(distDirectory: string) {
  const found: string[] = []
  const visit = async (directory: string, depth: number): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const child = path.join(directory, entry.name)
      if (entry.name.endsWith("-unpacked")) {
        found.push(child)
        continue
      }
      if (depth < 2) await visit(child, depth + 1)
    }
  }
  await visit(distDirectory, 0)
  return found.sort()
}

async function macExecutables(distDirectory: string) {
  const found: string[] = []
  const visit = async (directory: string, depth: number): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const child = path.join(directory, entry.name)
      if (entry.name.endsWith(".app")) {
        const executableDirectory = path.join(child, "Contents", "MacOS")
        for (const executable of await readdir(executableDirectory, { withFileTypes: true }).catch(() => [])) {
          if (executable.isFile() && executable.name.toLowerCase().includes("disklizard")) {
            found.push(path.join(executableDirectory, executable.name))
          }
        }
        continue
      }
      if (depth < 3) await visit(child, depth + 1)
    }
  }
  await visit(distDirectory, 0)
  return found.sort()
}

/** Locate only the executable in electron-builder's unpacked staging app. */
export async function findPackagedExecutable(
  distDirectory: string,
  platform: NodeJS.Platform = process.platform,
): Promise<string> {
  let candidates: string[] = []
  if (platform === "darwin") {
    candidates = await macExecutables(distDirectory)
  } else {
    for (const unpacked of await unpackedDirectories(distDirectory)) {
      for (const entry of await readdir(unpacked, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.toLowerCase().includes("disklizard")) continue
        if (platform === "win32" && !entry.name.toLowerCase().endsWith(".exe")) continue
        if (platform !== "win32" && entry.name.toLowerCase().endsWith(".exe")) continue
        candidates.push(path.join(unpacked, entry.name))
      }
    }
    candidates.sort()
  }
  if (candidates.length === 0) throw new Error(`No packaged DiskLizard executable found under ${distDirectory}`)
  if (candidates.length > 1) {
    throw new Error(`Multiple packaged DiskLizard executables found: ${candidates.join(", ")}`)
  }
  return candidates[0]!
}

export async function findDistributableArtifact(
  distDirectory: string,
  platform: NodeJS.Platform = process.platform,
): Promise<{ path: string; format: ArtifactFormat; bytes: number }> {
  const format: ArtifactFormat = platform === "darwin" ? "zip" : platform === "win32" ? "nsis" : "appimage"
  const matches = (await readdir(distDirectory, { withFileTypes: true }))
    .filter((entry) => {
      if (!entry.isFile()) return false
      const lower = entry.name.toLowerCase()
      if (platform === "darwin") return lower.endsWith(".zip")
      if (platform === "win32") return lower.endsWith(".exe")
      return lower.endsWith(".appimage")
    })
    .map((entry) => path.join(distDirectory, entry.name))
    .sort()
  if (matches.length === 0) throw new Error(`No DiskLizard distributable found under ${distDirectory}`)
  if (matches.length > 1) throw new Error(`Multiple DiskLizard distributables found: ${matches.join(", ")}`)
  return { path: matches[0]!, format, bytes: (await stat(matches[0]!)).size }
}

export function artifactExecutionMode(platform: SupportedPlatform): PackagedSmokeReport["artifact"]["execution"] {
  if (platform === "darwin") return "zip-extracted"
  if (platform === "linux") return "appimage-extract-and-run"
  return "nsis-installed"
}

export function packagedLaunchOptions(
  executablePath: string,
  fixturePath: string,
  userDataPath: string,
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const smokeEnvironment = packagedSmokeEnvironment(environment)
  return {
    executablePath,
    args: [
      `${PACKAGED_SMOKE_FIXTURE_ARGUMENT}${fixturePath}`,
      `${PACKAGED_SMOKE_USER_DATA_ARGUMENT}${userDataPath}`,
      "--lang=en-US",
    ],
    env: {
      ...smokeEnvironment,
      ...(platform === "linux" ? { APPIMAGE_EXTRACT_AND_RUN: "1" } : {}),
      DISKLIZARD_REQUIRE_NATIVE_SCANNER: "1",
    },
    // Playwright otherwise adds --no-sandbox to Electron. Exercise the same
    // Chromium renderer sandbox policy as production on Linux as well.
    chromiumSandbox: true,
  }
}

async function runCommand(command: string, args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "inherit", "inherit"],
      windowsHide: true,
    })
    child.once("error", reject)
    child.once("close", (code, signal) => {
      if (code === 0 && signal === null) resolve()
      else reject(new Error(`${path.basename(command)} exited (${signal ?? code ?? "unknown"})`))
    })
  })
}

export async function findWindowsInstalledProgram(root: string, uninstall: boolean) {
  // The NSIS app and uninstaller live at the install root. Never recurse into
  // resources/native, where disklizard-scanner.exe is intentionally bundled.
  const matches = (await readdir(root, { withFileTypes: true }).catch(() => []))
    .filter((entry) => {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".exe")) return false
      const lower = entry.name.toLowerCase()
      return uninstall ? lower.includes("uninstall") : lower === "disklizard dev.exe"
    })
    .map((entry) => path.join(root, entry.name))
    .sort()
  if (matches.length !== 1) {
    throw new Error(`Expected one ${uninstall ? "NSIS uninstaller" : "installed DiskLizard executable"}; found ${matches.length}`)
  }
  return matches[0]!
}

async function cleanupWindowsInstallation(installDirectory: string) {
  const uninstaller = await findWindowsInstalledProgram(installDirectory, true).catch(() => undefined)
  if (uninstaller) await runCommand(uninstaller, ["/S"]).catch(() => undefined)
  await rm(installDirectory, { recursive: true, force: true })
}

async function prepareArtifactLaunch(
  artifact: Awaited<ReturnType<typeof findDistributableArtifact>>,
  runtimeDirectory: string,
  platform: SupportedPlatform,
) {
  if (platform === "darwin") {
    const extractedDirectory = path.join(runtimeDirectory, "zip-extracted")
    await mkdir(extractedDirectory, { recursive: true })
    await runCommand("/usr/bin/ditto", ["-x", "-k", artifact.path, extractedDirectory])
    return {
      executable: await findPackagedExecutable(extractedDirectory, platform),
      execution: artifactExecutionMode(platform),
      cleanup: async () => undefined,
    }
  }
  if (platform === "linux") {
    await chmod(artifact.path, 0o755)
    return {
      executable: artifact.path,
      execution: artifactExecutionMode(platform),
      cleanup: async () => undefined,
    }
  }

  const installDirectory = path.join(runtimeDirectory, "nsis-installed")
  await mkdir(installDirectory, { recursive: true })
  // `/D` must be the final NSIS argument. The install root is disposable and
  // the generated uninstaller is invoked after the Playwright journey.
  try {
    await runCommand(artifact.path, ["/S", `/D=${installDirectory}`])
    return {
      executable: await findWindowsInstalledProgram(installDirectory, false),
      execution: artifactExecutionMode(platform),
      cleanup: () => cleanupWindowsInstallation(installDirectory),
    }
  } catch (error) {
    await cleanupWindowsInstallation(installDirectory)
    throw error
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function minimalPdf() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources <<>> /Contents 4 0 R >>",
    "<< /Length 0 >>\nstream\n\nendstream",
  ]
  let document = "%PDF-1.4\n"
  const offsets = [0]
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(document))
    document += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xref = Buffer.byteLength(document)
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  document += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return document
}

async function createFixture(root: string) {
  const id = randomUUID()
  const fixturePath = path.join(root, `fixture-${id}`)
  const userDataPath = path.join(root, `profile-${id}`)
  const xdgDataPath = path.join(root, `xdg-${id}`)
  const ballastPath = path.join(fixturePath, "scan-progress-ballast")
  const previewName = `preview-${id}.txt`
  const pdfName = `preview-${id}.pdf`
  const deleteName = `delete-me-${id}.txt`
  const previewContent = `DiskLizard packaged preview ${id}`
  const deleteContent = `DiskLizard packaged Trash marker ${id}`
  await Promise.all([
    mkdir(ballastPath, { recursive: true }),
    mkdir(userDataPath, { recursive: true }),
    mkdir(xdgDataPath, { recursive: true }),
  ])
  await Promise.all([
    writeFile(path.join(fixturePath, previewName), previewContent),
    writeFile(path.join(fixturePath, pdfName), minimalPdf()),
    writeFile(path.join(fixturePath, deleteName), deleteContent),
  ])
  // A real native traversal must outlive the 120 ms production progress
  // interval. Chunking keeps fixture setup bounded on slower CI filesystems.
  for (let start = 0; start < 20_000; start += 250) {
    await Promise.all(
      Array.from({ length: 250 }, (_, offset) =>
        writeFile(path.join(ballastPath, `entry-${String(start + offset).padStart(5, "0")}.bin`), "x"),
      ),
    )
  }
  return {
    fixturePath,
    userDataPath,
    xdgDataPath,
    previewName,
    previewContent,
    pdfName,
    deleteName,
    deleteContent,
  }
}

async function openPackagedWindow(
  executable: string,
  fixture: Awaited<ReturnType<typeof createFixture>>,
  platform: SupportedPlatform,
  tracePath: string,
) {
  const application = await electron.launch(
    packagedLaunchOptions(executable, fixture.fixturePath, fixture.userDataPath, platform, {
      ...process.env,
      ...(platform === "linux" ? { XDG_DATA_HOME: fixture.xdgDataPath } : {}),
    }),
  )
  const pageErrors: Error[] = []
  const cspErrors: string[] = []
  const observedPages = new WeakSet<Page>()
  const observePage = (candidate: Page) => {
    if (observedPages.has(candidate)) return
    observedPages.add(candidate)
    candidate.on("pageerror", (error) => pageErrors.push(error))
    candidate.on("console", (message) => {
      const text = message.text()
      if (/content security policy/i.test(text)) cspErrors.push(text)
    })
  }
  application.context().on("page", observePage)
  application.context().pages().forEach(observePage)
  await application.context().tracing.start({ screenshots: true, snapshots: true, sources: true })
  let page: Page | undefined
  try {
    page = await application.firstWindow()
    observePage(page)
    await page.waitForLoadState("domcontentloaded")
    await expect(page.locator(".dl-shell")).toBeVisible({ timeout: 30_000 })
    return { application, page, pageErrors, cspErrors, tracePath }
  } catch (error) {
    if (page && !page.isClosed()) {
      await page
        .screenshot({ path: tracePath.replace(/\.zip$/, "-startup-failure.png"), fullPage: true })
        .catch(() => undefined)
    }
    await application.context().tracing.stop({ path: tracePath }).catch(() => undefined)
    await application.close().catch(() => undefined)
    throw error
  }
}

async function closePackagedWindow(opened: Awaited<ReturnType<typeof openPackagedWindow>>) {
  await opened.application.context().tracing.stop({ path: opened.tracePath }).catch(() => undefined)
  await opened.application.close()
  if (opened.pageErrors.length > 0) {
    throw new Error(`Packaged renderer failed: ${opened.pageErrors.map((error) => error.message).join("; ")}`)
  }
  if (opened.cspErrors.length > 0) {
    throw new Error(`Packaged renderer violated its CSP: ${opened.cspErrors.join("; ")}`)
  }
}

async function beginProgressObservation(page: Page) {
  // Evaluate source text rather than a TypeScript callback. tsx/esbuild names
  // nested callbacks with its private `__name` helper, which is unavailable
  // when Playwright serializes the callback into the renderer process.
  await page.evaluate(`(() => {
    document.documentElement.dataset.disklizardPackagedProgress = "false";
    document.documentElement.dataset.disklizardPackagedProgressBeforeMap = "false";
    const observe = () => {
      const element = document.querySelector("[data-scan-files]");
      const value = element && element.getAttribute("data-scan-files");
      if (value && Number(value) > 0) {
        document.documentElement.dataset.disklizardPackagedProgress = "true";
        if (!document.querySelector("[data-map-size]")) {
          document.documentElement.dataset.disklizardPackagedProgressBeforeMap = "true";
        }
      }
    };
    new MutationObserver(observe).observe(document.body, {
      attributes: true,
      attributeFilter: ["data-scan-files"],
      childList: true,
      subtree: true,
    });
    observe();
  })()`)
}

async function scanFixture(page: Page, fixturePath: string, source: "scan" | "snapshot") {
  const fixtureLabel = path.basename(fixturePath)
  // Native menu typography and localized renderer copy may expose either the
  // single ellipsis character or three dots to the accessibility tree.
  const scanFolder = page
    .locator("footer.dl-volume-footer")
    .getByRole("button", { name: /^Scan Folder(?:…|\.\.\.)$/ })
  await expect(scanFolder).toBeEnabled({ timeout: 30_000 })
  await scanFolder.click()
  const map = page.getByRole("region", {
    name: new RegExp(`^Storage map for ${escapeRegExp(fixtureLabel)}\\.`),
  })
  await expect(map).toBeVisible({ timeout: 90_000 })
  await expect(page.locator(".dl-shell")).toHaveAttribute("data-scan-source", source, { timeout: 10_000 })
  return map
}

async function verifyPreview(page: Page, fixture: Awaited<ReturnType<typeof createFixture>>) {
  await page.getByRole("button", { name: /^List(?:\s+\d+)?$/ }).click()
  const row = page.locator("[data-disk-index]").filter({ hasText: fixture.previewName })
  await expect(row).toHaveCount(1)
  await row.dblclick()
  const dialog = page.getByRole("dialog", { name: fixture.previewName, exact: true })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel(`Text preview of ${fixture.previewName}`, { exact: true })).toHaveText(
    fixture.previewContent,
  )
  await dialog.getByRole("button", { name: "Close preview", exact: true }).click()
  await expect(dialog).toBeHidden()

  const pdfRow = page.locator("[data-disk-index]").filter({ hasText: fixture.pdfName })
  await expect(pdfRow).toHaveCount(1)
  await pdfRow.dblclick()
  const pdfDialog = page.getByRole("dialog", { name: fixture.pdfName, exact: true })
  await expect(pdfDialog).toBeVisible()
  await expect(pdfDialog.locator('iframe[src^="data:application/pdf;base64,"]')).toBeVisible()
  await pdfDialog.getByRole("button", { name: "Close preview", exact: true }).click()
  await expect(pdfDialog).toBeHidden()
}

async function moveFixtureToTrash(
  page: Page,
  fixture: Awaited<ReturnType<typeof createFixture>>,
  mapBytesBeforeDelete: number,
) {
  await page.getByRole("button", { name: `Select ${fixture.deleteName} for review`, exact: true }).click()
  await page.getByRole("button", { name: "Review selected", exact: true }).click()
  const review = page.getByRole("dialog").filter({ hasText: fixture.deleteName })
  await expect(review).toBeVisible()
  await review.getByRole("button", { name: /^Move to (?:Trash|Recycle Bin)$/ }).click()
  await expect(review).toBeHidden({ timeout: 30_000 })
  await expect(page.getByRole("button", { name: `Select ${fixture.deleteName} for review`, exact: true })).toHaveCount(0)
  await expect
    .poll(() =>
      access(path.join(fixture.fixturePath, fixture.deleteName), fsConstants.F_OK).then(
        () => false,
        () => true,
      ),
    )
    .toBe(true)
  const mapButton = page.getByRole("tab", { name: /^Map(?:\s+1)?$/ })
  await expect(mapButton).toBeEnabled({ timeout: 90_000 })
  await mapButton.click()
  const map = page.getByRole("region", {
    name: new RegExp(`^Storage map for ${escapeRegExp(path.basename(fixture.fixturePath))}\\.`),
  })
  await expect(map).toBeVisible()
  await expect
    .poll(async () => Number((await map.getAttribute("data-map-size")) ?? Number.NaN))
    .toBeLessThan(mapBytesBeforeDelete)
}

async function cleanupOwnedTrashEntry(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  platform: SupportedPlatform,
) {
  if (platform === "win32") {
    const deletedPath = path.join(fixture.fixturePath, fixture.deleteName)
    const recycleRoot = path.join(path.parse(deletedPath).root, "$Recycle.Bin")
    const owned = await findOwnedWindowsRecycleEntry(recycleRoot, fixture.deleteContent)
    await rm(owned.contentPath, { force: true })
    await rm(owned.metadataPath, { force: true })
    return
  }
  const trashedPath =
    platform === "darwin"
      ? path.join(homedir(), ".Trash", fixture.deleteName)
      : path.join(fixture.xdgDataPath, "Trash", "files", fixture.deleteName)
  const text = await readFile(trashedPath, "utf8")
  if (text !== fixture.deleteContent) throw new Error("OS Trash destination did not contain the disposable marker")
  await rm(trashedPath, { force: true })
  if (platform === "linux") {
    await rm(path.join(fixture.xdgDataPath, "Trash", "info", `${fixture.deleteName}.trashinfo`), { force: true })
  }
}

/** Locate exactly one marker owned by this smoke run without emptying or enumerating via the shell Recycle Bin UI. */
export async function findOwnedWindowsRecycleEntry(recycleRoot: string, expectedContent: string) {
  const matches: Array<{ contentPath: string; metadataPath: string }> = []
  let inspected = 0
  const expectedBytes = Buffer.byteLength(expectedContent)
  for (const owner of (await readdir(recycleRoot, { withFileTypes: true }).catch(() => [])).slice(0, 64)) {
    if (!owner.isDirectory()) continue
    const ownerDirectory = path.join(recycleRoot, owner.name)
    for (const entry of (await readdir(ownerDirectory, { withFileTypes: true }).catch(() => [])).slice(0, 4096)) {
      if (++inspected > 16_384) throw new Error("Windows Recycle Bin smoke search exceeded its safety bound")
      if (!entry.isFile() || !entry.name.startsWith("$R")) continue
      const contentPath = path.join(ownerDirectory, entry.name)
      const info = await stat(contentPath).catch(() => undefined)
      if (!info?.isFile() || info.size !== expectedBytes) continue
      if ((await readFile(contentPath, "utf8").catch(() => undefined)) !== expectedContent) continue
      const metadataPath = path.join(ownerDirectory, `$I${entry.name.slice(2)}`)
      const metadata = await stat(metadataPath).catch(() => undefined)
      if (!metadata?.isFile()) throw new Error("Owned Windows Recycle Bin marker has no metadata record")
      matches.push({ contentPath, metadataPath })
    }
  }
  if (matches.length !== 1) throw new Error(`Expected one owned Windows Recycle Bin marker; found ${matches.length}`)
  return matches[0]!
}

function supportedPlatform(value: NodeJS.Platform): SupportedPlatform {
  if (value === "darwin" || value === "linux" || value === "win32") return value
  throw new Error(`Packaged smoke is unsupported on ${value}`)
}

export async function runPackagedAppSmoke(input: {
  distDirectory: string
  reportPath: string
  platform?: NodeJS.Platform
}) {
  const platform = supportedPlatform(input.platform ?? process.platform)
  const workspaceDirectory = path.resolve(scriptDirectory, "../../..")
  const desktopPackage = JSON.parse(await readFile(path.resolve(scriptDirectory, "../package.json"), "utf8")) as {
    version?: unknown
  }
  if (typeof desktopPackage.version !== "string") throw new Error("Desktop package version is missing")
  const evidenceDirectory = path.join(path.dirname(input.reportPath), `packaged-smoke-${platform}`)
  const runtimeDirectory = path.join(workspaceDirectory, "test-results", `packaged-smoke-runtime-${randomUUID()}`)
  let launchTarget: Awaited<ReturnType<typeof prepareArtifactLaunch>> | undefined
  let opened: Awaited<ReturnType<typeof openPackagedWindow>> | undefined
  try {
    await Promise.all([
      mkdir(path.dirname(input.reportPath), { recursive: true }),
      rm(input.reportPath, { force: true }),
      rm(evidenceDirectory, { recursive: true, force: true }),
      mkdir(evidenceDirectory, { recursive: true }),
      mkdir(runtimeDirectory, { recursive: true }),
    ])
    const [artifact, boundary, updateMetadata, fixture] = await Promise.all([
      findDistributableArtifact(input.distDirectory, platform),
      inspectPackagedBoundary(input.distDirectory),
      verifyElectronUpdaterMetadata(input.distDirectory, platform, desktopPackage.version),
      createFixture(runtimeDirectory),
    ])
    launchTarget = await prepareArtifactLaunch(artifact, runtimeDirectory, platform)
    opened = await openPackagedWindow(
      launchTarget.executable,
      fixture,
      platform,
      path.join(evidenceDirectory, "first-launch.zip"),
    )
    await beginProgressObservation(opened.page)
    await scanFixture(opened.page, fixture.fixturePath, "scan")
    await expect(opened.page.locator("html")).toHaveAttribute("data-disklizard-packaged-progress", "true")
    await expect(opened.page.locator("html")).toHaveAttribute("data-disklizard-packaged-progress-before-map", "true")
    await closePackagedWindow(opened)
    opened = undefined

    opened = await openPackagedWindow(
      launchTarget.executable,
      fixture,
      platform,
      path.join(evidenceDirectory, "relaunch.zip"),
    )
    const restoredMap = await scanFixture(opened.page, fixture.fixturePath, "snapshot")
    const mapBytesBeforeDelete = Number(await restoredMap.getAttribute("data-map-size"))
    if (!Number.isSafeInteger(mapBytesBeforeDelete) || mapBytesBeforeDelete <= 0) {
      throw new Error("Restored storage map did not expose a positive tree-backed byte total")
    }
    await verifyPreview(opened.page, fixture)
    await moveFixtureToTrash(opened.page, fixture, mapBytesBeforeDelete)
    await opened.page.screenshot({ path: path.join(evidenceDirectory, "completed.png"), fullPage: true })
    await closePackagedWindow(opened)
    opened = undefined
    await cleanupOwnedTrashEntry(fixture, platform)
    const report: PackagedSmokeReport = {
      schemaVersion: 6,
      journey: "renderer-preload-ipc",
      platform,
      artifact: {
        file: path.basename(artifact.path),
        format: artifact.format,
        bytes: artifact.bytes,
        archiveEntries: boundary.archiveEntries,
        execution: launchTarget.execution,
        unpackedBytes: boundary.unpackedBytes,
      },
      updateMetadata: {
        file: updateMetadata.metadataFile,
        version: updateMetadata.version,
        sha512Verified: true,
        blockmapPresent: true,
      },
      firstLaunch: { mapVisible: true, progressObserved: true, progressBeforeMap: true, scanSource: "scan" },
      preview: { textExactContent: true, pdfEmbedded: true },
      relaunch: { mapVisible: true, scanSource: "snapshot" },
      rendererSecurity: { cspErrors: 0 },
      trash: { mapUpdated: true, sourceRemoved: true, destinationVerified: true, integration: "shell.trashItem" },
    }
    validatePackagedSmokeReport(report)
    await writeFile(input.reportPath, `${JSON.stringify(report, null, 2)}\n`)
    console.log(`[disklizard] packaged renderer/preload/IPC smoke passed (${platform}): ${input.reportPath}`)
    return report
  } catch (error) {
    if (opened && !opened.page.isClosed()) {
      await opened.page.screenshot({ path: path.join(evidenceDirectory, "failure.png"), fullPage: true }).catch(() => undefined)
    }
    throw error
  } finally {
    if (opened) await closePackagedWindow(opened).catch(() => undefined)
    try {
      await launchTarget?.cleanup()
    } finally {
      await rm(runtimeDirectory, { recursive: true, force: true })
    }
  }
}

function argumentValue(name: string) {
  return process.argv.find((argument) => argument.startsWith(`${name}=`))?.slice(name.length + 1)
}

async function ensureLinuxDisplay() {
  if (process.platform !== "linux" || process.env.DISPLAY || process.env.WAYLAND_DISPLAY || process.env.DISKLIZARD_SMOKE_XVFB) {
    return false
  }
  const tsxExecutable = path.resolve(scriptDirectory, "../node_modules/.bin/tsx")
  const status = await new Promise<number>((resolve, reject) => {
    const child = spawn("xvfb-run", ["-a", tsxExecutable, scriptPath, ...process.argv.slice(2)], {
      env: { ...process.env, DISKLIZARD_SMOKE_XVFB: "1" },
      stdio: "inherit",
    })
    child.once("error", reject)
    child.once("close", (code, signal) => {
      if (signal !== null) reject(new Error(`xvfb-run exited (${signal})`))
      else resolve(code ?? 1)
    })
  })
  process.exit(status)
}

const isMain = !!process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
if (isMain && !(await ensureLinuxDisplay())) {
  const desktopDirectory = path.resolve(scriptDirectory, "..")
  const workspaceDirectory = path.resolve(desktopDirectory, "../..")
  await runPackagedAppSmoke({
    distDirectory: path.resolve(argumentValue("--dist") ?? path.join(desktopDirectory, "dist-smoke")),
    reportPath: path.resolve(
      argumentValue("--report") ?? path.join(workspaceDirectory, "test-results", `packaged-smoke-${process.platform}.json`),
    ),
  })
}
