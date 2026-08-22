import { afterAll, describe, expect, test } from "bun:test"
import { chmod, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { nativeScannerAvailable } from "./native"
import { scanPathWithBackend } from "./backend"
import { generateGoldenCorpus } from "./fixtures"
import { runDiskLizardCli } from "./cli"

const roots: string[] = []

afterAll(async () => {
  await Promise.all(
    roots.map(async (root) => {
      await chmod(join(root, "secret"), 0o755).catch(() => undefined)
      await rm(root, { recursive: true, force: true })
    }),
  )
})

describe("preferred scan backend", () => {
  test("uses the native sidecar when it is present and reports accounting evidence", async () => {
    const root = await mkdtemp(join(tmpdir(), "disklizard-backend-"))
    roots.push(root)
    await generateGoldenCorpus(root)
    const result = await scanPathWithBackend(root, { sizeMode: "physical", useWorker: false })
    expect(nativeScannerAvailable()).toBe(true)
    expect(result.backend).toBe("native")
    expect(result.accounting).toBe("physical")
    expect(["complete", "partial"]).toContain(result.evidence)
    expect(result.root.path).toBe(root)
    expect(result.root.size).toBeGreaterThan(0)
  })

  test("CLI --json is produced by the real CLI entry and includes backend metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "disklizard-cli-json-"))
    roots.push(root)
    await generateGoldenCorpus(root)
    const lines: string[] = []
    await runDiskLizardCli([root, "--json", "--max-depth", "6"], (line) => lines.push(String(line)))
    const payload = JSON.parse(lines.join("\n")) as { backend: string; accounting: string; evidence: string; root: { path: string; size: number } }
    expect(payload.backend).toBe("native")
    expect(payload.accounting).toBe("physical")
    expect(["complete", "partial"]).toContain(payload.evidence)
    expect(payload.root.path).toBe(root)
    expect(payload.root.size).toBeGreaterThan(0)
  })
})
