#!/usr/bin/env bun
import { existsSync } from "node:fs"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Worker } from "node:worker_threads"

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const workerPath = path.resolve(scriptDirectory, "../out/main/native-parse-worker.js")
const scannerName = process.platform === "win32" ? "disklizard-scanner.exe" : "disklizard-scanner"
const scannerPath = path.resolve(scriptDirectory, "../native", scannerName)

if (!process.versions.electron) throw new Error("Native worker smoke must run in Electron's Node runtime")
if (!existsSync(workerPath)) throw new Error(`Built native parse worker is missing: ${workerPath}`)
if (!existsSync(scannerPath)) throw new Error(`Built native scanner is missing: ${scannerPath}`)

const root = await mkdtemp(path.join(tmpdir(), "disklizard-worker-smoke-"))
try {
  await writeFile(path.join(root, "fixture.bin"), new Uint8Array(64))
  const requestJson = JSON.stringify({
    targetPath: root,
    maxDepth: 4,
    maxChildren: 48,
    preserveNames: [],
    collapseNames: [],
    signatureNames: [],
    progressIntervalMs: 1,
    sizeMode: "logical",
    excludePaths: [],
  })
  const worker = new Worker(workerPath, {
    workerData: {
      scannerPath,
      requestJson,
      platform: process.platform,
      expectedRootPath: root,
      inventoryEnabled: false,
    },
  })

  const result = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      void worker.terminate()
      reject(new Error("Built native parse worker smoke test timed out"))
    }, 15_000)
    timeout.unref()

    worker.on("message", (message) => {
      if (message.type === "progress") return
      clearTimeout(timeout)
      resolve(message)
    })
    worker.once("error", (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    worker.once("exit", (code) => {
      if (code === 0) return
      clearTimeout(timeout)
      reject(new Error(`Built native parse worker exited (${code})`))
    })
  })

  if (result.type === "error") throw new Error(result.message)
  if (result.type !== "done" || result.root.path !== root || result.root.children[0]?.name !== "fixture.bin") {
    throw new Error("Built native parse worker returned an unexpected tree")
  }
  console.log(`[disklizard] built worker smoke passed in Electron: ${workerPath}`)
} finally {
  await rm(root, { recursive: true, force: true })
}
