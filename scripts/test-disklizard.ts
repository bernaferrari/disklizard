#!/usr/bin/env bun
import { spawnSync } from "node:child_process"
import { mkdirSync, readdirSync, writeFileSync } from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")

const GENERATED_DIRECTORIES = new Set([
  ".git",
  ".turbo",
  "coverage",
  "dist",
  "dist-smoke",
  "node_modules",
  "out",
  "playwright-report",
  "target",
  "test-results",
])

function generatedPath(relativePath: string) {
  return relativePath.split(sep).some((segment) => GENERATED_DIRECTORIES.has(segment))
}

function testFiles(dir: string, cwd: string, skip: (relativePath: string) => boolean = () => false) {
  const found: string[] = []
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name)
      const rel = relative(dir, full)
      if (generatedPath(rel) || skip(rel)) continue
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx")) found.push(relative(cwd, full))
    }
  }
  walk(dir)
  return found.sort()
}

const scannerCwd = resolve(root, "packages/disklizard")
const desktopCwd = resolve(root, "packages/desktop")
const appCwd = resolve(root, "packages/app")
const scannerTests = testFiles(resolve(scannerCwd, "src"), scannerCwd)
const desktopTests = testFiles(desktopCwd, desktopCwd, (rel) =>
  rel.split(sep).some((segment) => segment === "onboarding" || segment.startsWith("onboarding.")),
)
const storageTests = testFiles(resolve(appCwd, "src/pages/disk-utility"), appCwd)
const localizationTests = testFiles(resolve(appCwd, "src/i18n"), appCwd)

const steps = [
  {
    name: "scanner and TUI",
    cwd: scannerCwd,
    tests: scannerTests,
    args: ["test", ...scannerTests],
  },
  {
    name: "desktop DiskLizard suite",
    cwd: desktopCwd,
    tests: desktopTests,
    args: ["test", "--isolate", ...desktopTests],
  },
  {
    name: "storage interface",
    cwd: appCwd,
    tests: storageTests,
    args: ["test", "--preload", "./happydom.ts", ...storageTests],
  },
  {
    name: "standalone localization",
    cwd: appCwd,
    tests: localizationTests,
    args: ["test", "--preload", "./happydom.ts", ...localizationTests],
  },
]

for (const step of steps) {
  console.log(`[test:disklizard] discovered ${step.tests.length} tests for ${step.name}`)
  if (step.tests.length === 0) throw new Error(`[test:disklizard] zero tests discovered for ${step.name}`)
}

let failed = false
const summary: Array<{ name: string; discovered: number; status: number; durationMs: number }> = []
for (const step of steps) {
  console.log(`\n[test:disklizard] ${step.name}`)
  const startedAt = Date.now()
  const result = spawnSync("bun", step.args, { cwd: step.cwd, stdio: "inherit" })
  const status = result.status ?? 1
  summary.push({ name: step.name, discovered: step.tests.length, status, durationMs: Date.now() - startedAt })
  if (result.status !== 0) {
    failed = true
    console.error(`[test:disklizard] ${step.name} failed`)
  }
}

const artifactDirectory = resolve(root, "test-results")
mkdirSync(artifactDirectory, { recursive: true })
writeFileSync(
  resolve(artifactDirectory, "disklizard-summary.json"),
  `${JSON.stringify({ status: failed ? "failed" : "passed", groups: summary }, null, 2)}\n`,
)

process.exit(failed ? 1 : 0)
