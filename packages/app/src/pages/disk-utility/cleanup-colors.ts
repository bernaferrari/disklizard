import type { DiskLanguageKey } from "./runtime"

/**
 * Each kind of clutter keeps one color everywhere it appears — the summary
 * bar, its legend, and the group badge — drawn from the same OKLCH family as
 * the storage map so Clean up reads as part of the same app.
 */
const CATEGORY_HUE: Partial<Record<DiskLanguageKey, number>> = {
  "disk.ui.cleanup.buildOutput": 255,
  "disk.ui.cleanup.dependencies": 290,
  "disk.ui.cleanup.category.caches": 195,
  "disk.ui.cleanup.category.logs": 70,
  "disk.ui.cleanup.category.tools": 160,
}

const NEUTRAL_KEYS = new Set<DiskLanguageKey>([
  "disk.ui.cleanup.category.other",
  "disk.ui.cleanup.other",
])

/** Far-apart hues for project groups, which have no fixed category. */
const SPREAD = [255, 25, 160, 320, 85, 200, 345, 120, 290, 55]

export const CLEANUP_NEUTRAL = "oklch(0.7 0.012 260)"

export function cleanupGroupColor(
  group: { labelKey: DiskLanguageKey; label?: string },
  index: number
) {
  if (!group.label && NEUTRAL_KEYS.has(group.labelKey)) return CLEANUP_NEUTRAL
  const hue = group.label
    ? SPREAD[index % SPREAD.length]
    : (CATEGORY_HUE[group.labelKey] ?? SPREAD[index % SPREAD.length])
  // Mid lightness and moderate chroma hold up on both light and dark grounds.
  return `oklch(0.68 0.13 ${hue})`
}
