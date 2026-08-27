import type { DeveloperItem } from "./recognize"
import { daysSinceChanged } from "./format"
import { diskLanguageText } from "./runtime"

/**
 * Age controls deliberately describe modification time rather than "last used":
 * files can be read without changing their mtime, so the latter would be an
 * unsafe promise.
 */
export const DEVELOPER_CLEANUP_AGE_PRESETS = ["all", "30", "60", "90", "180", "custom"] as const

export type DeveloperCleanupAgePreset = (typeof DEVELOPER_CLEANUP_AGE_PRESETS)[number]

export type DeveloperCleanupAge = { valid: true; days?: number } | { valid: false; days?: never }

const MAX_CUSTOM_AGE_DAYS = 3650

/** Resolve the UI value without treating an invalid custom value as "all". */
export function resolveDeveloperCleanupAge(preset: DeveloperCleanupAgePreset, customDays: string): DeveloperCleanupAge {
  if (preset === "all") return { valid: true }
  if (preset !== "custom") return { valid: true, days: Number(preset) }

  const parsed = Number(customDays)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_CUSTOM_AGE_DAYS) return { valid: false }
  return { valid: true, days: parsed }
}

/**
 * Keep unknown dates out of an age-qualified result. The caller can still use
 * the "Any age" policy to inspect them manually.
 */
export function matchesDeveloperCleanupAge(
  modifiedAt: number | undefined,
  age: DeveloperCleanupAge,
  now = Date.now(),
): boolean {
  if (!age.valid) return false
  if (age.days === undefined) return true
  const days = daysSinceChanged(modifiedAt, now)
  return days !== null && days >= age.days
}

export function filterDeveloperItemsByAge(
  items: readonly DeveloperItem[],
  age: DeveloperCleanupAge,
  now = Date.now(),
): DeveloperItem[] {
  return items.filter(({ node }) => matchesDeveloperCleanupAge(node.modifiedAt, age, now))
}

export function developerCleanupAgeLabel(age: DeveloperCleanupAge): string {
  if (!age.valid) return diskLanguageText("disk.developer.policy.invalidAge")
  return age.days === undefined
    ? diskLanguageText("disk.developer.policy.anyDate")
    : diskLanguageText("disk.developer.policy.ageLabel", { count: age.days })
}
