import type { DeveloperArtifact } from "@/core"
import type { DiskScanNode } from "@/pages/disk-utility/types"
import { captureBaseline } from "@/pages/disk-utility/scan-baseline"

/**
 * Browser-only design fixture (`?fixture=demo`): a deterministic, Mac-shaped
 * volume with enough depth, breadth, and developer artifacts to judge the
 * explorer and cleanup surfaces at a realistic scale.
 */

const KB = 1024
const MB = KB * 1024
const GB = MB * 1024
const DAY = 86_400_000
const NOW = Date.UTC(2026, 8, 28)

let seed = 7
function random() {
  seed = (seed * 16807) % 2147483647
  return (seed - 1) / 2147483646
}

type Spec = {
  name: string
  size?: number
  ageDays?: number
  children?: Spec[]
  /** Generate this many anonymous files sharing `size` roughly. */
  files?: { count: number; ext: string; prefix: string; total: number }
}

function build(spec: Spec, parent: string): DiskScanNode {
  const path =
    parent === ""
      ? "/"
      : parent === "/"
        ? `/${spec.name}`
        : `${parent}/${spec.name}`
  const modifiedAt = NOW - (spec.ageDays ?? Math.floor(random() * 400)) * DAY
  const children: DiskScanNode[] = (spec.children ?? []).map((child) =>
    build(child, path)
  )
  if (spec.files) {
    const { count, ext, prefix, total } = spec.files
    const weights = Array.from({ length: count }, () => random() ** 2.4 + 0.02)
    const sum = weights.reduce((a, b) => a + b, 0)
    weights.forEach((weight, index) => {
      const size = Math.round((weight / sum) * total)
      children.push({
        name: `${prefix}${String(index + 1).padStart(3, "0")}${ext}`,
        path: `${path}/${prefix}${String(index + 1).padStart(3, "0")}${ext}`,
        size,
        logicalSize: size,
        modifiedAt: modifiedAt - Math.floor(random() * 90) * DAY,
        isDir: false,
        ext,
        children: [],
      })
    })
  }
  const isDir = !!spec.children || !!spec.files
  const size = isDir
    ? children.reduce((total, child) => total + child.size, 0) +
      (spec.size ?? 0)
    : (spec.size ?? 0)
  children.sort((a, b) => b.size - a.size)
  return {
    name: spec.name,
    path,
    size,
    logicalSize: size,
    modifiedAt,
    isDir,
    ext: isDir ? "" : (spec.name.match(/\.[^.]+$/)?.[0] ?? ""),
    children,
  }
}

const dir = (name: string, children: Spec[], ageDays?: number): Spec => ({
  name,
  children,
  ageDays,
})
const file = (name: string, size: number, ageDays?: number): Spec => ({
  name,
  size,
  ageDays,
})
const bulk = (
  name: string,
  total: number,
  count: number,
  ext: string,
  prefix = "item-",
  ageDays?: number
): Spec => ({ name, ageDays, files: { count, ext, prefix, total } })

function project(name: string, ageDays: number, scale: number): Spec {
  return dir(
    name,
    [
      bulk("node_modules", 1.4 * GB * scale, 60, "", "pkg-", ageDays),
      bulk("src", 42 * MB * scale, 30, ".ts", "module-", ageDays),
      bulk(".git", 380 * MB * scale, 12, ".pack", "pack-", ageDays),
      bulk("dist", 160 * MB * scale, 14, ".js", "chunk-", ageDays),
      bulk(".next", 520 * MB * scale, 16, "", "cache-", ageDays),
      file("package.json", 3 * KB, ageDays),
    ],
    ageDays
  )
}

function rustProject(name: string, ageDays: number, scale: number): Spec {
  return dir(
    name,
    [
      bulk("target", 4.6 * GB * scale, 24, "", "build-", ageDays),
      bulk("src", 12 * MB * scale, 18, ".rs", "mod-", ageDays),
      bulk(".git", 120 * MB * scale, 6, ".pack", "pack-", ageDays),
      file("Cargo.toml", 2 * KB, ageDays),
    ],
    ageDays
  )
}

const tree = dir("Macintosh HD", [
  dir("Users", [
    dir("alex", [
      dir("Library", [
        dir("Developer", [
          dir("Xcode", [
            bulk("DerivedData", 38 * GB, 22, "", "Project-", 40),
            bulk("iOS DeviceSupport", 24 * GB, 6, "", "17.", 210),
            bulk("Archives", 6.2 * GB, 8, ".xcarchive", "Build ", 300),
          ]),
          bulk("CoreSimulator", 46 * GB, 14, "", "Device-", 30),
        ]),
        dir("Caches", [
          bulk("com.spotify.client", 9.4 * GB, 20, "", "data-", 2),
          bulk("Homebrew", 7.8 * GB, 40, ".tar.gz", "bottle-", 12),
          bulk("com.apple.Safari", 1.9 * GB, 18, "", "cache-", 1),
          bulk("Google", 3.4 * GB, 12, "", "chrome-", 1),
          bulk("pip", 2.2 * GB, 16, ".whl", "wheel-", 60),
        ]),
        dir("Application Support", [
          bulk("Steam", 64 * GB, 12, "", "game-", 90),
          bulk("Slack", 4.4 * GB, 10, "", "store-", 1),
          bulk("Code", 3.1 * GB, 20, "", "ext-", 3),
          bulk("MobileSync", 58 * GB, 4, "", "Backup-", 400),
        ]),
        bulk("Containers", 41 * GB, 60, "", "com.app-", 20),
        bulk("Mail", 12 * GB, 30, ".mbox", "Mailbox-", 5),
        bulk("Logs", 1.1 * GB, 40, ".log", "log-", 8),
      ]),
      dir("Projects", [
        project("web-dashboard", 3, 1.2),
        project("marketing-site", 190, 0.8),
        project("legacy-admin", 420, 1),
        rustProject("disk-scanner", 12, 1),
        rustProject("old-cli", 360, 0.7),
        project("design-system", 75, 0.9),
        project("side-project", 610, 0.6),
      ]),
      dir("Movies", [
        bulk("Final Cut", 112 * GB, 8, ".fcpbundle", "Library ", 220),
        bulk("Screen Recordings", 38 * GB, 70, ".mov", "Recording ", 30),
      ]),
      dir("Pictures", [
        bulk("Photos Library.photoslibrary", 164 * GB, 40, "", "masters-", 1),
        bulk("Lightroom", 22 * GB, 30, ".dng", "IMG_", 120),
      ]),
      dir("Downloads", [
        file("Xcode_16.4.xip", 11.2 * GB, 150),
        file("ubuntu-24.04-desktop-arm64.iso", 5.8 * GB, 330),
        file("Figma-Installer.dmg", 280 * MB, 90),
        bulk("Old Stuff", 14 * GB, 90, ".zip", "archive-", 500),
        bulk("Screenshots", 2.4 * GB, 180, ".png", "Screenshot ", 60),
      ]),
      dir("Documents", [
        bulk("Parallels", 68 * GB, 3, ".pvm", "Windows 11 ", 45),
        bulk("Work", 18 * GB, 120, ".pdf", "doc-", 20),
        bulk("Taxes", 1.2 * GB, 40, ".pdf", "return-", 300),
      ]),
      dir("Music", [bulk("Music", 44 * GB, 90, ".m4a", "Track ", 700)]),
      dir(".docker", [bulk("Docker.raw", 32 * GB, 2, ".raw", "layer-", 4)]),
      bulk(".npm", 4.8 * GB, 50, "", "cache-", 20),
      bulk(".cargo", 3.6 * GB, 30, "", "registry-", 25),
      bulk(".Trash", 9.2 * GB, 40, "", "Deleted ", 10),
    ]),
    dir("Shared", [bulk("Adobe", 6 * GB, 10, "", "shared-", 200)]),
  ]),
  dir("private", [
    dir("var", [
      bulk("vm", 12 * GB, 3, "", "swapfile", 0),
      bulk("folders", 22 * GB, 50, "", "tmp-", 1),
      bulk("db", 3.4 * GB, 40, "", "db-", 2),
      bulk("log", 1.8 * GB, 30, ".log", "system-", 1),
    ]),
    bulk("tmp", 900 * MB, 20, "", "tmp-", 0),
  ]),
  dir("System", [
    dir("Library", [
      bulk("Frameworks", 9 * GB, 70, ".framework", "Framework", 60),
      bulk("PrivateFrameworks", 14 * GB, 80, ".framework", "Private", 60),
      bulk("AssetsV2", 18 * GB, 30, "", "asset-", 30),
    ]),
    bulk("Applications", 6 * GB, 30, ".app", "System App ", 60),
  ]),
  dir("Applications", [
    file("Xcode.app", 14.6 * GB, 120),
    file("Final Cut Pro.app", 6.4 * GB, 200),
    file("Logic Pro.app", 3.1 * GB, 200),
    file("Docker.app", 2.1 * GB, 20),
    file("Figma.app", 540 * MB, 10),
    file("Slack.app", 410 * MB, 5),
    file("Visual Studio Code.app", 620 * MB, 3),
    bulk("Utilities", 1.4 * GB, 20, ".app", "Utility ", 200),
  ]),
  dir("Library", [
    bulk("Application Support", 8 * GB, 30, "", "support-", 60),
    bulk("Developer", 7 * GB, 10, "", "CommandLineTools-", 90),
    bulk("Fonts", 1.1 * GB, 80, ".ttf", "Font ", 400),
  ]),
  dir("opt", [dir("homebrew", [bulk("Cellar", 14 * GB, 90, "", "formula-", 20)])]),
  dir("usr", [bulk("local", 1.2 * GB, 20, "", "lib-", 90)]),
])

function find(root: DiskScanNode, path: string): DiskScanNode | undefined {
  if (root.path === path) return root
  for (const child of root.children)
    if (path.startsWith(child.path)) {
      const match = find(child, path)
      if (match) return match
    }
  return undefined
}

function artifacts(root: DiskScanNode): DeveloperArtifact[] {
  const out: DeveloperArtifact[] = []
  let id = 1000
  const visit = (node: DiskScanNode) => {
    const kind =
      node.name === "node_modules"
        ? (["dependencies", "node"] as const)
        : node.name === "target"
          ? (["build-output", "rust"] as const)
          : node.name === ".next" || node.name === "dist"
            ? (["build-output", "web"] as const)
            : node.name === "DerivedData" || node.name === "CoreSimulator"
              ? (["toolchain-cache", "apple"] as const)
              : node.name === ".npm"
                ? (["toolchain-cache", "node"] as const)
                : undefined
    if (kind && node.isDir) {
      out.push({
        name: node.name,
        path: node.path,
        size: node.size,
        modifiedAt: node.modifiedAt,
        isDir: true,
        kind: kind[0],
        ecosystem: kind[1],
        confidence: node.name === "dist" ? "likely" : "verified",
        cleanup: node.name === "dist" ? "review" : "eligible",
        evidence: [`name:${node.name}`],
        inventoryOnly: true,
        directoryIdentity: {
          platform: "posix",
          device: "16777232",
          fileId: String(id++),
          modifiedAt: node.modifiedAt ?? NOW,
        },
      })
      return
    }
    node.children.forEach(visit)
  }
  visit(root)
  return out
}

/** Collapse each directory beyond `limit` direct children into a synthetic `Other`. */
function withOther(node: DiskScanNode, limit = 24): DiskScanNode {
  const children = node.children.map((child) => withOther(child, limit))
  if (children.length <= limit) return { ...node, children }
  const kept = children.slice(0, limit)
  const rest = children.slice(limit)
  const size = rest.reduce((total, child) => total + child.size, 0)
  return {
    ...node,
    children: [
      ...kept,
      {
        name: `Other (${rest.length} items)`,
        path: `${node.path}/__other__`,
        size,
        logicalSize: size,
        isDir: true,
        isOther: true,
        otherCount: rest.length,
        ext: "",
        children: rest.slice(0, 2),
      },
    ],
  }
}

export const DEMO_ROOT_PATH = "/"
export const DEMO_DRIVE_TOTAL = 2 * 1024 * GB

export function demoScanTree(): DiskScanNode {
  seed = 7
  const root = withOther(build(tree, ""))
  const items = artifacts(root)
  return {
    ...root,
    cloneMetadata: { state: "available" },
    sharedStorageEvidence: "complete",
    scanIssues: {
      unreadableCount: 291,
      samplePaths: [
        "/private/etc/cups/certs",
        "/private/var/networkd/Library",
        "/private/var/networkd/db",
        "/private/var/install",
        "/private/var/spool/mqueue",
      ],
    },
    developerArtifactInventory: {
      items,
      status: {
        state: "complete",
        maxItems: 2000,
        scannedDirectories: 48_210,
        matchedDirectories: items.length,
        truncated: false,
        unreadableCount: 0,
        unreadableSamplePaths: [],
        skippedSymlinkCount: 0,
        skippedSymlinkSamplePaths: [],
        excludedCount: 0,
        excludedSamplePaths: [],
      },
    },
  }
}

export function demoSubtree(path: string) {
  const root = demoScanTree()
  return find(root, path)
}

function resize(node: DiskScanNode): number {
  if (!node.isDir || !node.children.length || node.isOther) return node.size
  node.size = node.children.reduce((total, child) => total + resize(child), 0)
  node.logicalSize = node.size
  return node.size
}

/**
 * The same machine nine days earlier: one project had not been installed
 * yet, DerivedData was smaller, and a VM that has since been deleted still
 * existed. Seeds the “since last scan” comparison in the browser fixture.
 */
export function demoPreviousBaseline() {
  const root = demoScanTree()
  const at = (path: string) => find(root, path)
  const project = at("/Users/alex/Projects/web-dashboard")
  if (project)
    project.children = project.children.filter(
      (child) => child.name !== "node_modules" && child.name !== ".next"
    )
  const derived = at("/Users/alex/Library/Developer/Xcode/DerivedData")
  derived?.children.forEach((child) => {
    child.size = Math.round(child.size * 0.4)
  })
  const recordings = at("/Users/alex/Movies/Screen Recordings")
  if (recordings) recordings.children = recordings.children.slice(20)
  const documents = at("/Users/alex/Documents")
  documents?.children.push({
    name: "Ubuntu Server.utm",
    path: "/Users/alex/Documents/Ubuntu Server.utm",
    size: 22 * GB,
    logicalSize: 22 * GB,
    isDir: true,
    ext: "",
    children: [],
  })
  resize(root)
  return captureBaseline(root, NOW - 9 * DAY)
}
