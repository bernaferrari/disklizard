import { afterAll, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { Worker } from "node:worker_threads"
import { fileURLToPath } from "node:url"
import { scanInWorker, scanWorkerHref } from "./scan"

const roots: string[] = []
afterAll(async () => {
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  )
})

const dir = dirname(fileURLToPath(import.meta.url))

describe("compiled TypeScript scan worker", () => {
  test("rejects a clean worker exit without a terminal result", async () => {
    const root = await mkdtemp(join(tmpdir(), "disklizard-worker-exit-"))
    roots.push(root)
    const fixture = join(root, "worker.ts")
    await writeFile(fixture, "process.exit(0)\n")
    const controller = new AbortController()
    const deadline = setTimeout(
      () => controller.abort(new Error("Worker did not settle")),
      2000,
    )
    try {
      await expect(
        scanInWorker(
          root,
          { signal: controller.signal },
          () => new Worker(fixture),
        ),
      ).rejects.toThrow("Scan worker exited with code 0")
    } finally {
      clearTimeout(deadline)
    }
  })
  test("does not launch an eval'd template-string worker", () => {
    const scan = readFileSync(join(dir, "scan.ts"), "utf8")
    const worker = readFileSync(join(dir, "scan-worker.ts"), "utf8")
    expect(scan).not.toContain("WORKER_SOURCE")
    expect(scan).not.toContain("eval: true")
    expect(scan).toContain("scan-worker.ts")
    expect(worker).toContain("scanPathSync")
    expect(String(scanWorkerHref())).toContain("scan-worker.ts")
  })
})
