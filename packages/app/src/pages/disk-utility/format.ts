/** Human-readable sizes & numbers for the disk utility UI. */

const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"]

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
