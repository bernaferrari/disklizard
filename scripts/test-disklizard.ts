#!/usr/bin/env bun
import { spawnSync } from "node:child_process"
import { readdirSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")

function testFiles(dir: string, skip: (relativePath: string) => boolean) {
  const found: string[] = []
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name)
      const rel = relative(dir, full)
      if (skip(rel)) continue
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx")) found.push(rel)
    }
  }
  walk(dir)
  return found.sort()
}

const desktopTests = testFiles(resolve(root, "packages/desktop"), (rel) => {
  return rel.split("/").includes("wsl") || rel.includes("draft-store") || rel.includes("onboarding")
})

const steps = [
  {
    name: "scanner and TUI",
    cwd: resolve(root, "packages/disklizard"),
    args: ["test", "src"],
  },
  {
    name: "desktop DiskLizard suite",
    cwd: resolve(root, "packages/desktop"),
    args: ["test", "--isolate", ...desktopTests],
  },
  {
    name: "storage interface",
    cwd: resolve(root, "packages/app"),
    args: ["test", "--conditions=solid", "--preload", "./happydom.ts", "./src/pages/disk-utility"],
  },
]

let failed = false
for (const step of steps) {
  console.log(`\n[test:disklizard] ${step.name}`)
  const result = spawnSync("bun", step.args, { cwd: step.cwd, stdio: "inherit" })
  if (result.status !== 0) {
    failed = true
    console.error(`[test:disklizard] ${step.name} failed`)
  }
}

process.exit(failed ? 1 : 0)
