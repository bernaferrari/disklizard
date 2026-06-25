/** Human-readable sizes — shared by desktop UI and TUI */

export function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB", "PB"]
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const val = bytes / Math.pow(1024, i)
  if (val < 10) return `${val.toFixed(2)} ${units[i]}`
  if (val < 100) return `${val.toFixed(1)} ${units[i]}`
  return `${Math.round(val)} ${units[i]}`
}

export function formatPct(part: number, whole: number): string {
  if (!whole || part <= 0) return "0%"
  const pct = (part / whole) * 100
  if (pct < 0.1) return "<0.1%"
  if (pct < 10) return `${pct.toFixed(1)}%`
  return `${pct.toFixed(0)}%`
}

export function truncate(s: string, n: number): string {
  if (s.length <= n) return s
  return s.slice(0, Math.max(1, n - 1)) + "…"
}

export function pad(s: string, width: number, align: "left" | "right" = "left"): string {
  if (s.length >= width) return s.slice(0, width)
  const padLen = width - s.length
  return align === "right" ? " ".repeat(padLen) + s : s + " ".repeat(padLen)
}
