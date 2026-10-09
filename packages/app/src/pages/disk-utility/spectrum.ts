import type { DiskScanNode } from "./types"

/** Path identity determines each top-level branch's color, so a neighbour
 * growing never repaints it. Inside a branch, hue fans out across a band sized
 * to the branch's share of the disk: a folder holding most of the disk reads
 * as a full spectrum instead of one flat color, while small branches stay a
 * tight family. Shared by map, tiles, and list. */

const HUE_START = 150
const HUE_SWEEP = 300

export type SpectrumTone = { L: number; C: number; h: number }

export function spectrumHue(fraction: number) {
  return (HUE_START + Math.max(0, Math.min(1, fraction)) * HUE_SWEEP) % 360
}

function inSrgb(L: number, C: number, hue: number) {
  const a = C * Math.cos((hue * Math.PI) / 180)
  const b = C * Math.sin((hue * Math.PI) / 180)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].every((channel) => channel >= 0 && channel <= 1)
}

const chromaCache = new Map<number, number>()
function maxChroma(L: number, hue: number) {
  const key = Math.round(L * 200) * 1000 + Math.round(hue)
  const cached = chromaCache.get(key)
  if (cached !== undefined) return cached
  let low = 0
  let high = 0.37
  for (let step = 0; step < 16; step++) {
    const mid = (low + high) / 2
    if (inSrgb(L, mid, hue)) low = mid
    else high = mid
  }
  chromaCache.set(key, low)
  return low
}

/**
 * Inner rings are the most saturated; each ring outward lifts slightly and
 * loses a little chroma so hierarchy reads before detail. Yellow and cyan get
 * extra lightness to stay luminous next to blue and violet.
 */
export function spectrumTone(
  hue: number,
  depth = 0,
  directory = true,
  theme: "light" | "dark" = "light"
): SpectrumTone {
  const warmth = Math.max(0, Math.cos(((hue - 105) * Math.PI) / 180))
  const cyan = Math.max(0, Math.cos(((hue - 195) * Math.PI) / 150))
  const level = Math.max(0, Math.min(8, depth))
  // Blue and violet only reach full chroma at lower lightness; yellow and
  // green need more. Following the gamut keeps every hue equally vivid.
  const L = Math.min(
    0.9,
    0.63 + warmth * 0.24 + cyan * 0.12 + level * 0.016 - (directory ? 0 : 0.03)
  )
  const fraction = Math.max(0.78, (directory ? 1 : 0.8) - level * 0.03)
  const lightness = theme === "dark" ? Math.min(0.86, L + 0.025) : L
  const ceiling = theme === "dark" ? 0.13 : 0.17
  return {
    L: lightness,
    C: Math.min(ceiling, maxChroma(lightness, hue) * fraction),
    h: hue,
  }
}

export function toneCss({ L, C, h }: SpectrumTone, alpha = 1) {
  const hue = ((h % 360) + 360) % 360
  return alpha >= 1
    ? `oklch(${L.toFixed(3)} ${C.toFixed(3)} ${hue.toFixed(1)})`
    : `oklch(${L.toFixed(3)} ${C.toFixed(3)} ${hue.toFixed(1)} / ${alpha})`
}

/**
 * Aggregates keep their branch hue while receding slightly from named items.
 */
export function aggregateTone(
  depth = 0,
  hue = 260,
  theme: "light" | "dark" = "light"
): SpectrumTone {
  const branch = spectrumTone(hue, depth, true, theme)
  return { L: Math.min(0.9, branch.L + 0.035), C: branch.C * 0.7, h: hue }
}

const sortedChildren = new WeakMap<DiskScanNode, DiskScanNode[]>()
function bySize(node: DiskScanNode) {
  let sorted = sortedChildren.get(node)
  if (!sorted) {
    sorted = (node.children ?? [])
      .filter((child) => child.size > 0)
      .toSorted((a, b) => b.size - a.size)
    sortedChildren.set(node, sorted)
  }
  return sorted
}

function isWithin(path: string, parent: string) {
  if (path === parent) return true
  const prefix =
    parent.endsWith("/") || parent.endsWith("\\") ? parent : parent + "/"
  return path.startsWith(prefix) || path.startsWith(parent + "\\")
}

export type SpectrumPosition = {
  start: number
  end: number
  depth: number
  branchStart: number
  branchEnd: number
  branchPath: string
}

/** Deterministic across refreshed observations, additions, and size sorting. */
function pathHash(path: string) {
  let hash = 2166136261
  for (const char of path.replaceAll("\\", "/"))
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  return hash >>> 0
}

/**
 * Top-level branch hues: evenly spaced around the wheel and visited in an
 * order where consecutive slots are far apart, so when two paths hash to the
 * same slot the second still lands on a clearly different color.
 */
const BRANCH_HUES = [255, 25, 150, 320, 85, 200, 345, 120, 285, 55]

/**
 * The ten largest siblings get distinct slots keyed by path, visited in path
 * order, so growth elsewhere never repaints a big folder. Smaller siblings
 * beyond those follow their size rank through the same far-apart sequence,
 * half a step off, so neighbours on the ring never share a color.
 */
function assignBranchHues(childrenBySize: readonly DiskScanNode[]) {
  const hues = new Map<string, number>()
  const used = new Set<number>()
  const leading = childrenBySize.slice(0, BRANCH_HUES.length)
  for (const child of leading.toSorted((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0
  )) {
    let slot = pathHash(child.path) % BRANCH_HUES.length
    while (used.has(slot)) slot = (slot + 1) % BRANCH_HUES.length
    used.add(slot)
    hues.set(child.path, BRANCH_HUES[slot])
  }
  childrenBySize.slice(BRANCH_HUES.length).forEach((child, index) => {
    const hue = BRANCH_HUES[index % BRANCH_HUES.length] + 18
    hues.set(child.path, hue % 360)
  })
  return hues
}

/** Degrees of hue a branch may span, proportional to its share of the root. */
function branchBand(share: number) {
  return Math.max(64, Math.min(300, share * 330))
}

/**
 * Resolve a path's angular range inside `root` without walking the whole
 * tree: descend only through the ancestors of the target.
 */
export function createSpectrum(
  root: DiskScanNode | null | undefined,
  theme: "light" | "dark" = "light"
) {
  const memo = new Map<string, SpectrumPosition | null>()
  const locate = (path: string): SpectrumPosition | undefined => {
    if (!root) return undefined
    const hit = memo.get(path)
    if (hit !== undefined) return hit ?? undefined
    let node = root
    let start = 0
    let end = 1
    let depth = -1
    let branchStart = 0
    let branchEnd = 1
    let branchPath = ""
    while (node.path !== path) {
      const children = bySize(node)
      const total = children.reduce((sum, child) => sum + child.size, 0)
      if (!total) break
      let cursor = start
      let next: DiskScanNode | undefined
      for (const child of children) {
        const span = ((end - start) * child.size) / total
        if (isWithin(path, child.path)) {
          next = child
          start = cursor
          end = cursor + span
          break
        }
        cursor += span
      }
      if (!next) break
      node = next
      depth += 1
      if (depth === 0) {
        branchPath = node.path
        branchStart = start
        branchEnd = end
      }
    }
    const found = node.path === path && depth >= 0
    const position = found
      ? { start, end, depth, branchStart, branchEnd, branchPath }
      : null
    memo.set(path, position)
    return position ?? undefined
  }

  let branchHues: Map<string, number> | undefined
  const branchHue = (path: string) => {
    branchHues ??= assignBranchHues(root ? bySize(root) : [])
    return (
      branchHues.get(path) ?? BRANCH_HUES[pathHash(path) % BRANCH_HUES.length]
    )
  }

  const tone = (node: Pick<DiskScanNode, "path" | "isDir" | "isOther">) => {
    const position = locate(node.path)
    if (!position) return undefined
    const anchor = branchHue(position.branchPath)
    const branchSpan = position.branchEnd - position.branchStart
    // Where this node sits inside its branch, from -0.5 to 0.5.
    const offset =
      position.depth === 0 || branchSpan <= 0
        ? 0
        : ((position.start + position.end) / 2 - position.branchStart) /
            branchSpan -
          0.5
    const hue = (anchor + offset * branchBand(branchSpan) + 360) % 360
    if (node.isOther) return aggregateTone(position.depth, hue, theme)
    return spectrumTone(hue, position.depth, node.isDir, theme)
  }

  return {
    locate,
    tone,
    color(node: Pick<DiskScanNode, "path" | "isDir" | "isOther">) {
      const value = tone(node)
      return value ? toneCss(value) : undefined
    },
  }
}

export type Spectrum = ReturnType<typeof createSpectrum>
