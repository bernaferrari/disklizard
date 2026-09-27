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
  return new Map(
    paths.map((path, index) => {
      const segments = parts[index]
      let length = Math.min(3, segments.length)
      while (
        length < segments.length &&
        parts.some(
          (other, otherIndex) =>
            otherIndex !== index &&
            other.slice(-length).join("/") === segments.slice(-length).join("/")
        )
      )
        length++
      const label = segments.slice(-length).join("/")
      return [path, length < segments.length ? `…/${label}` : path] as const
    })
  )
}
