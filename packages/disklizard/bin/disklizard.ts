#!/usr/bin/env bun
/**
 * DiskLizard TUI entry — shared core with Desktop.
 *
 *   bun packages/disklizard/bin/disklizard.ts
 *   bun packages/disklizard/bin/disklizard.ts ~/Downloads
 *   bun packages/disklizard/bin/disklizard.ts C:\
 */

import { runDiskLizardCli } from "../src/cli"

try {
  await runDiskLizardCli(process.argv.slice(2))
} catch (error) {
  console.error(`disklizard: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
