/** DiskLizard design tokens — agent-board accent system fused with safety verdicts. */

import type { Safety } from "./recognize"

export type Accent = {
  dot: string
  text: string
  pill: string
  bar: string
  /** Raw OKLCH stroke color for canvas/SVG (donut rings, swatches). */
  stroke: string
}

/**
 * Safety verdicts — the heart of the "Reclaim" feature. Each maps to one OKLCH
 * accent used consistently across the banner, list badges, and review drawer.
 */
export const SAFETY_ACCENT: Record<Safety, Accent> = {
  regenerable: {
    dot: "bg-[#3fb950]",
    text: "text-[#1a7f37]",
    pill: "bg-[#238636]/14 text-[color-mix(in_oklch,#1a7f37_62%,var(--text-strong))] ring-[#3fb950]/45",
    bar: "bg-[#3fb950]",
    stroke: "oklch(0.72 0.17 145)",
  },
  cache: {
    dot: "bg-[#39c5cf]",
    text: "text-[#0969da]",
    pill: "bg-[#39c5cf]/16 text-[color-mix(in_oklch,#0e7490_62%,var(--text-strong))] ring-[#39c5cf]/45",
    bar: "bg-[#39c5cf]",
    stroke: "oklch(0.75 0.12 200)",
  },
  logs: {
    dot: "bg-[#d29922]",
    text: "text-[#9a6700]",
    pill: "bg-[#9e6a03]/14 text-[color-mix(in_oklch,#9a6700_62%,var(--text-strong))] ring-[#d29922]/45",
    bar: "bg-[#d29922]",
    stroke: "oklch(0.75 0.14 80)",
  },
  trash: {
    dot: "bg-[#a371f7]",
    text: "text-[#8250df]",
    pill: "bg-[#8957e5]/14 text-[color-mix(in_oklch,#8250df_62%,var(--text-strong))] ring-[#a371f7]/45",
    bar: "bg-[#a371f7]",
    stroke: "oklch(0.65 0.18 300)",
  },
  media: {
    dot: "bg-[#58a6ff]",
    text: "text-[#0969da]",
    pill: "bg-[#58a6ff]/14 text-[color-mix(in_oklch,#0969da_62%,var(--text-strong))] ring-[#58a6ff]/45",
    bar: "bg-[#58a6ff]",
    stroke: "oklch(0.7 0.15 245)",
  },
  "version-control": {
    dot: "bg-[#f85149]",
    text: "text-[#cf222e]",
    pill: "bg-[#da3633]/14 text-[color-mix(in_oklch,#cf222e_62%,var(--text-strong))] ring-[#f85149]/45",
    bar: "bg-[#f85149]",
    stroke: "oklch(0.65 0.22 25)",
  },
  system: {
    dot: "bg-[#d29922]",
    text: "text-[#9a6700]",
    pill: "bg-[#9e6a03]/14 text-[color-mix(in_oklch,#9a6700_62%,var(--text-strong))] ring-[#d29922]/45",
    bar: "bg-[#d29922]",
    stroke: "oklch(0.75 0.14 80)",
  },
  unknown: {
    dot: "bg-text-weak",
    text: "text-text-weak",
    pill: "bg-surface-raised-base text-text-weak ring-border-weaker-base",
    bar: "bg-text-weak/50",
    stroke: "oklch(0.6 0.01 0)",
  },
}

/** Cycled OKLCH hues for the ranked list when an item has no sunburst swatch. */
export const SIZE_BAR_TONES = [
  "oklch(0.7 0.15 250)",
  "oklch(0.72 0.17 145)",
  "oklch(0.75 0.14 80)",
  "oklch(0.65 0.18 300)",
  "oklch(0.66 0.22 25)",
  "oklch(0.75 0.12 200)",
  "oklch(0.7 0.16 30)",
  "oklch(0.68 0.16 330)",
]

export function sizeBarTone(index: number): string {
  return SIZE_BAR_TONES[index % SIZE_BAR_TONES.length]
}

/** Drive usage severity — green → amber → red as a volume fills up. */
export function usageTone(used: number, total: number): string {
  if (!total) return "bg-surface-raised-base text-text-weak ring-border-weaker-base"
  const pct = used / total
  if (pct >= 0.9) return "bg-[#da3633]/14 text-[color-mix(in_oklch,#cf222e_62%,var(--text-strong))] ring-[#f85149]/45"
  if (pct >= 0.75) return "bg-[#9e6a03]/14 text-[color-mix(in_oklch,#9a6700_62%,var(--text-strong))] ring-[#d29922]/45"
  return "bg-[#238636]/14 text-[color-mix(in_oklch,#1a7f37_62%,var(--text-strong))] ring-[#3fb950]/45"
}

/** Usage stroke color (OKLCH) for SVG donut rings. */
export function usageStroke(used: number, total: number): string {
  if (!total) return "oklch(0.6 0.01 0)"
  const pct = used / total
  if (pct >= 0.9) return "oklch(0.66 0.22 25)"
  if (pct >= 0.75) return "oklch(0.75 0.14 80)"
  return "oklch(0.72 0.17 145)"
}

export function idTone(): string {
  return "rounded bg-surface-raised-base px-1.5 py-0.5 font-mono text-10-semibold text-text-weak ring-1 ring-inset ring-border-weaker-base"
}
