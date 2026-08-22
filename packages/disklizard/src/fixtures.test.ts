import { afterAll, describe, expect, test } from "bun:test"
import { chmod, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { scanPathWithBackend } from "./backend"
import { accountingFromTree, generateGoldenCorpus } from "./fixtures"
import { scanPath, scanPathSync, scanWorkerHref } from "./scan"

const roots: string[] = []

afterAll(async () => {
  await Promise.all(
    roots.map(async (root) => {
      await chmod(join(root, "secret"), 0o755).catch(() => undefined)
      await rm(root, { recursive: true, force: true })
    }),
  )
})

describe("golden accounting fixtures", () => {
  test("native, in-process, and worker backends agree on the generated corpus", async () => {
    const root = await mkdtemp(join(tmpdir(), "disklizard-golden-"))
    roots.push(root)
    const expected = await generateGoldenCorpus(root)

    const sync = await scanPathSync(root, { sizeMode: "physical", useWorker: false, maxDepth: 8 })
    const worker = await scanPath(root, { sizeMode: "physical", useWorker: true, maxDepth: 8 })
    const preferred = await scanPathWithBackend(root, { sizeMode: "physical", useWorker: false, maxDepth: 8 })

    const syncAccounting = accountingFromTree(sync)
    const workerAccounting = accountingFromTree(worker)
    const preferredAccounting = accountingFromTree(preferred.root)

    expect(syncAccounting.apparentBytes).toBeGreaterThan(0)
    expect(workerAccounting.apparentBytes).toBe(syncAccounting.apparentBytes)
    expect(preferredAccounting.apparentBytes).toBe(syncAccounting.apparentBytes)
    expect(syncAccounting.allocatedBytes).toBe(workerAccounting.allocatedBytes)
    expect(preferred.accounting).toBe("physical")
    expect(["native", "typescript"]).toContain(preferred.backend)
    expect(syncAccounting.apparentBytes).toBeGreaterThanOrEqual(expected.apparentBytes - 512)
    expect(String(scanWorkerHref())).toContain("scan-worker.ts")
    expect(scanWorkerHref().href.endsWith("scan-worker.ts")).toBe(true)
  })
})
