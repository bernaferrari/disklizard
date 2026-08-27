/** DiskLizard design tokens — agent-board accent system fused with safety verdicts. */

import type { Safety } from "./recognize"

export type Accent = {
  dot: string
  pill: string
}

/**
 * Safety verdicts — the heart of the "Reclaim" feature. Each maps to one OKLCH
 * accent used consistently across the banner, list badges, and review drawer.
 */
export const SAFETY_ACCENT: Record<Safety, Accent> = {
  regenerable: {
    dot: "bg-[#3fb950]",
    pill: "bg-[#238636]/14 text-[color-mix(in_oklch,#1a7f37_62%,var(--text-strong))] ring-[#3fb950]/45",
  },
  cache: {
    dot: "bg-[#39c5cf]",
    pill: "bg-[#39c5cf]/16 text-[color-mix(in_oklch,#0e7490_62%,var(--text-strong))] ring-[#39c5cf]/45",
  },
  logs: {
    dot: "bg-[#d29922]",
    pill: "bg-[#9e6a03]/14 text-[color-mix(in_oklch,#9a6700_62%,var(--text-strong))] ring-[#d29922]/45",
  },
  trash: {
    dot: "bg-[#a371f7]",
    pill: "bg-[#8957e5]/14 text-[color-mix(in_oklch,#8250df_62%,var(--text-strong))] ring-[#a371f7]/45",
  },
  media: {
    dot: "bg-[#58a6ff]",
    pill: "bg-[#58a6ff]/14 text-[color-mix(in_oklch,#0969da_62%,var(--text-strong))] ring-[#58a6ff]/45",
  },
  "version-control": {
    dot: "bg-[#f85149]",
    pill: "bg-[#da3633]/14 text-[color-mix(in_oklch,#cf222e_62%,var(--text-strong))] ring-[#f85149]/45",
  },
  system: {
    dot: "bg-[#d29922]",
    pill: "bg-[#9e6a03]/14 text-[color-mix(in_oklch,#9a6700_62%,var(--text-strong))] ring-[#d29922]/45",
  },
  unknown: {
    dot: "bg-text-weak",
    pill: "bg-surface-raised-base text-text-weak ring-border-weaker-base",
  },
}

/**
 * Selection/focus ring stroke for canvas/SVG surfaces (sunburst, treemap).
 * Theme-aware: the app publishes `data-color-scheme` on the root element, and
 * each side stays visible against its own panel background.
 */
const RING_LIGHT = "oklch(0.52 0.14 252)"
const RING_DARK = "oklch(0.84 0.1 252)"

export function surfaceRing(): string {
  return document.documentElement.dataset.colorScheme === "dark" ? RING_DARK : RING_LIGHT
}

/** Usage stroke color (OKLCH) for SVG donut rings. */
export function usageStroke(used: number, total: number): string {
  if (!total) return "oklch(0.6 0.01 0)"
  const pct = used / total
  if (pct >= 0.9) return "oklch(0.66 0.22 25)"
  if (pct >= 0.75) return "oklch(0.75 0.14 80)"
  return "oklch(0.72 0.17 145)"
}
