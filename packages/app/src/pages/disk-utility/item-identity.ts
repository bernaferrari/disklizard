import type { DiskScanNode } from "./types"
import { diskNodeDisplayName } from "./node-display"

const PROJECT_ARTIFACT_NAMES = new Set([
  "target",
  "node_modules",
  "build",
  "dist",
  ".next",
  ".nuxt",
  ".turbo",
])

export function itemIdentity(node: DiskScanNode) {
  const artifact = diskNodeDisplayName(node)
  const parts = node.path.replaceAll("\\", "/").split("/").filter(Boolean)
  const parent = parts.at(-2)
  const project = PROJECT_ARTIFACT_NAMES.has(node.name) ? parent : undefined
  return {
    title: project ?? artifact,
    artifact,
    reviewTitle: project ? `${project} / ${artifact}` : artifact,
    path: node.path,
  }
}

/** The shortest trailing location that distinguishes every visible path. */
export function distinguishingPathLabels(paths: readonly string[]) {
  const parts = paths.map((path) =>
    path.replaceAll("\\", "/").split("/").filter(Boolean)
  )
  // Count suffixes once: a large inventory must not compare every pair of paths.
  const counts = new Map<string, number>()
  for (const segments of parts)
    for (
      let length = Math.min(3, segments.length);
      length <= segments.length;
      length++
    ) {
      const suffix = segments.slice(-length).join("/")
      counts.set(suffix, (counts.get(suffix) ?? 0) + 1)
    }
  return new Map(
    paths.map((path, index) => {
      const segments = parts[index]
      let length = Math.min(3, segments.length)
      while (
        length < segments.length &&
        (counts.get(segments.slice(-length).join("/")) ?? 0) > 1
      )
        length++
      const label = segments.slice(-length).join("/")
      return [path, length < segments.length ? `…/${label}` : path] as const
    })
  )
}

/** Home comes from the desktop bridge; other users and roots remain literal. */
export function abbreviateHomePath(path: string, homePath?: string) {
  if (!homePath) return path
  const home = homePath.replace(/[\\/]+$/, "")
  if (path === home) return "~"
  if (path.startsWith(home + "/") || path.startsWith(home + "\\"))
    return "~" + path.slice(home.length)
  return path
}

export function cleanupLocationLabels(
  paths: readonly string[],
  homePath?: string
) {
  const abbreviated = paths.map((path) => abbreviateHomePath(path, homePath))
  const labels = distinguishingPathLabels(abbreviated)
  return new Map(
    paths.map((path, index) => [path, labels.get(abbreviated[index])!])
  )
}
