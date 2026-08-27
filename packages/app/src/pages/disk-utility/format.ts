/** Human-readable sizes & numbers for the disk utility UI. */
import { diskLanguageText } from "./runtime"

const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"]
const DAY_MS = 24 * 60 * 60 * 1_000
export const DORMANT_AFTER_DAYS = 90

export function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return "0 B"
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1)
  const val = bytes / Math.pow(1024, i)
  if (val < 10) return `${val.toFixed(2)} ${UNITS[i]}`
  if (val < 100) return `${val.toFixed(1)} ${UNITS[i]}`
  return `${Math.round(val)} ${UNITS[i]}`
}

/** Compact form for tight spaces: "2.4 GB", "890 MB". */
export function shortBytes(bytes: number): string {
  if (!bytes || bytes === 0) return "0 B"
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1)
  const val = bytes / Math.pow(1024, i)
  return `${val >= 100 ? Math.round(val) : val >= 10 ? val.toFixed(0) : val.toFixed(1)} ${UNITS[i]}`
}

export function formatPct(part: number, whole: number): string {
  if (!whole || part <= 0) return "0%"
  const pct = (part / whole) * 100
  if (pct < 0.1) return "<0.1%"
  if (pct < 10) return `${pct.toFixed(1)}%`
  return `${pct.toFixed(0)}%`
}

export function formatCount(n: number): string {
  return n.toLocaleString()
}

export function truncatePath(s: string, n = 56): string {
  if (s.length <= n) return s
  return "…" + s.slice(-(n - 1))
}

export function daysSinceChanged(modifiedAt?: number, now = Date.now()): number | null {
  if (!modifiedAt || !Number.isFinite(modifiedAt)) return null
  return Math.max(0, Math.floor((now - modifiedAt) / DAY_MS))
}

export function isDormant(modifiedAt?: number, now = Date.now()): boolean {
  const days = daysSinceChanged(modifiedAt, now)
  return days !== null && days >= DORMANT_AFTER_DAYS
}

export function formatLastChanged(modifiedAt?: number, now = Date.now()): string {
  const days = daysSinceChanged(modifiedAt, now)
  if (days === null) return diskLanguageText("disk.changed.unavailable")
  if (days === 0) return diskLanguageText("disk.changed.today")
  if (days === 1) return diskLanguageText("disk.changed.yesterday")
  if (days < 14) return diskLanguageText("disk.changed.days", { count: days })
  if (days < 60) return diskLanguageText("disk.changed.weeks", { count: Math.floor(days / 7) })
  if (days < 730) return diskLanguageText("disk.changed.months", { count: Math.floor(days / 30) })
  return diskLanguageText("disk.changed.years", { count: Math.floor(days / 365) })
}
