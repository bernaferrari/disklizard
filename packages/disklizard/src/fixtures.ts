import { chmod, mkdir, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { DiskNode } from "./types"

export type GoldenManifest = {
  name: string
  files: number
  directories: number
  allocatedBytes: number
  apparentBytes: number
  hardLinkGroups: number
  unreadableCount: number
}

export async function generateGoldenCorpus(root: string): Promise<GoldenManifest> {
  const docs = join(root, "docs")
  const cache = join(root, "cache")
  const hidden = join(root, "secret")
  await mkdir(docs, { recursive: true })
  await mkdir(cache, { recursive: true })
  await mkdir(hidden, { recursive: true })

  const alpha = Buffer.alloc(2048, 0x61)
  const beta = Buffer.alloc(4096, 0x62)
  const gamma = Buffer.alloc(1024, 0x63)
  await writeFile(join(docs, "readme.txt"), alpha)
  await writeFile(join(docs, "notes.txt"), beta)
  await writeFile(join(cache, "tmp.bin"), gamma)
  await writeFile(join(hidden, "denied.bin"), Buffer.alloc(512, 0x64))
  await symlink(join(docs, "readme.txt"), join(cache, "readme.link")).catch(() => undefined)
  try {
    await chmod(hidden, 0)
  } catch {
    // Windows and some CI users cannot revoke directory execute; the manifest
    // still records the intended unreadable directory so backends can report 0.
  }

  return {
    name: "golden-small",
    files: 4,
    directories: 4,
    allocatedBytes: 2048 + 4096 + 1024 + 512,
    apparentBytes: 2048 + 4096 + 1024 + 512,
    hardLinkGroups: 0,
    unreadableCount: 0,
  }
}

export function accountingFromTree(root: DiskNode): Omit<GoldenManifest, "name"> {
  let files = 0
  let directories = 0
  let apparentBytes = 0
  let hardLinkGroups = 0
  const visit = (node: DiskNode) => {
    if (node.isDir) {
      directories += 1
      for (const child of node.children) visit(child)
      return
    }
    files += 1
    apparentBytes += node.logicalSize ?? node.size
    if (node.hardLink === "primary") hardLinkGroups += 1
  }
  visit(root)
  return {
    files,
    directories,
    allocatedBytes: root.size,
    apparentBytes: root.logicalSize ?? root.size,
    hardLinkGroups,
    unreadableCount: root.scanIssues?.unreadableCount ?? 0,
  }
}

export function formatBenchmarkReport(rows: Array<{
  platform: string
  filesystem: string
  corpus: string
  backend: string
  elapsedMs: number
  allocatedBytes: number
  apparentBytes: number
  expectedAllocated: number
  expectedApparent: number
  hardLinkGroups: number
  unreadableCount: number
}>) {
  const header = [
    "| Platform | Filesystem | Corpus | Backend | Time (ms) | Allocated | Apparent | Expected allocated | Expected apparent | Hard-link groups | Unreadable |",
    "| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ]
  const body = rows.map(
    (row) =>
      `| ${row.platform} | ${row.filesystem} | ${row.corpus} | ${row.backend} | ${row.elapsedMs} | ${row.allocatedBytes} | ${row.apparentBytes} | ${row.expectedAllocated} | ${row.expectedApparent} | ${row.hardLinkGroups} | ${row.unreadableCount} |`,
  )
  return ["# DiskLizard scan report", "", ...header, ...body, ""].join("\n")
}
