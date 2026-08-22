import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { scanWorkerHref } from "./scan"

const dir = dirname(fileURLToPath(import.meta.url))

describe("compiled TypeScript scan worker", () => {
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
