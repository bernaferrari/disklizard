import { homedir } from "node:os"
import { formatBytes } from "./format"
import { getDrives, scanPath } from "./scan"
import { runDiskLizardTui } from "./tui/app"
import type { DiskNode } from "./types"

export type DiskLizardCliOptions = {
  path?: string
  format: "tui" | "json" | "summary"
  maxDepth: number
  sizeMode: "physical" | "logical"
}

export function parseDiskLizardCliArgs(args: string[]): DiskLizardCliOptions | "help" {
  let path: string | undefined
  let format: DiskLizardCliOptions["format"] = "tui"
  let maxDepth = 10
  let sizeMode: DiskLizardCliOptions["sizeMode"] = "physical"

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === "--help" || arg === "-h") return "help"
    if (arg === "--json") {
      format = "json"
      continue
    }
    if (arg === "--summary") {
      format = "summary"
      continue
    }
    if (arg === "--logical") {
      sizeMode = "logical"
      continue
    }
    if (arg === "--max-depth") {
      const value = Number(args[++index])
      if (!Number.isInteger(value) || value < 0 || value > 64) throw new Error("--max-depth must be an integer from 0 to 64")
      maxDepth = value
      continue
    }
    if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`)
    if (path) throw new Error("Specify only one scan path")
    path = arg
  }

  return { path, format, maxDepth, sizeMode }
}

export function diskLizardCliHelp() {
  return `DiskLizard — developer-aware disk explorer

Usage:
  disklizard [path]                         Open the interactive terminal browser
  disklizard [path] --summary               Print a concise, read-only scan summary
  disklizard [path] --json                  Print the scan tree as JSON for agents/scripts

Options:
  --max-depth <0-64>  Materialized tree depth (default: 10)
  --logical           Report apparent file size instead of physical allocation
  --summary           Non-interactive human-readable output
  --json              Non-interactive machine-readable output
  -h, --help          Show this help

The CLI is read-only in every mode. Review and move items to Trash in the
desktop app, where DiskLizard revalidates supported developer artifacts before
the move.`
}

export async function runDiskLizardCli(args: string[], write = console.log): Promise<void> {
  const options = parseDiskLizardCliArgs(args)
  if (options === "help") return write(diskLizardCliHelp())
  if (options.format === "tui") return runDiskLizardTui(options)

  const drives = options.path ? undefined : await getDrives()
  const target = options.path ?? drives?.[0]?.path ?? homedir()
  const root = await scanPath(target, { maxDepth: options.maxDepth, sizeMode: options.sizeMode, useWorker: false })

  if (options.format === "json") return write(JSON.stringify(root, null, 2))
  write(formatDiskLizardSummary(root, options.sizeMode))
}

export function formatDiskLizardSummary(root: DiskNode, sizeMode: "physical" | "logical") {
  const size = sizeMode === "logical" ? (root.logicalSize ?? root.size) : root.size
  const lines = [`${root.path}`, `${formatBytes(size)} ${sizeMode === "logical" ? "apparent" : "allocated"} storage`]
  lines.push(...root.children.slice(0, 12).map((node) => `  ${formatBytes(sizeMode === "logical" ? (node.logicalSize ?? node.size) : node.size)}  ${node.name}`))
  if (root.scanIssues?.unreadableCount) lines.push(`  ${root.scanIssues.unreadableCount} unreadable locations (scan is partial)`)
  return lines.join("\n")
}
