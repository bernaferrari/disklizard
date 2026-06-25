#!/usr/bin/env bun
/**
 * DiskLizard TUI entry — shared core with Desktop.
 *
 *   bun packages/disklizard/bin/disklizard.ts
 *   bun packages/disklizard/bin/disklizard.ts ~/Downloads
 *   bun packages/disklizard/bin/disklizard.ts C:\
 */

import { runDiskLizardTui } from "../src/tui/app"

const arg = process.argv[2]
await runDiskLizardTui({ path: arg })
