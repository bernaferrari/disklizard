import { useMemo } from "react"
import type { DiskScanNode } from "./types"
import { layoutTreemap } from "./treemap"
import { formatBytes } from "./format"
import { aggregatePreviewCells } from "./aggregate-preview"

export function AggregatePreview(props: {
  children: DiskScanNode[]
  width: number
  height: number
  color: string
}) {
  const innerWidth = Math.max(0, props.width)
  const innerHeight = Math.max(0, props.height)
  const preview = useMemo(() => {
    if (!innerWidth || !innerHeight) return { paths: [], labels: [] }
    const cells = aggregatePreviewCells(props.children, innerWidth, innerHeight)
    const groups = ["", "", "", ""]
    const labels: { x: number; y: number; name: string; size: string }[] = []
    for (const [index, rect] of layoutTreemap(cells, {
      x: 0,
      y: 0,
      w: innerWidth,
      h: innerHeight,
    }).entries()) {
      const x = rect.x.toFixed(2)
      const y = rect.y.toFixed(2)
      const w = Math.max(0, rect.w).toFixed(2)
      const h = Math.max(0, rect.h).toFixed(2)
      groups[index % groups.length] += `M${x} ${y}h${w}v${h}h-${w}Z`
      if (
        !rect.node.isOther &&
        rect.w >= 72 &&
        rect.h >= 58 &&
        labels.length < 36
      ) {
        const maxChars = Math.max(3, Math.floor((rect.w - 12) / 6.5))
        labels.push({
          x: rect.x + 6,
          y: rect.y + 16,
          name:
            rect.node.name.length > maxChars
              ? `${rect.node.name.slice(0, maxChars - 1)}…`
              : rect.node.name,
          size: formatBytes(rect.node.size),
        })
      }
    }
    return { paths: groups, labels }
  }, [props.children, innerWidth, innerHeight])

  if (!preview.paths.length) return null
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
      style={{ width: innerWidth, height: innerHeight }}
      viewBox={`0 0 ${innerWidth} ${innerHeight}`}
      preserveAspectRatio="none"
    >
      {preview.paths.map((path, index) => (
        <path
          key={index}
          d={path}
          fill={`color-mix(in oklab, ${props.color} calc(var(--dl-tile-summary-mix) + ${index * 3}%), var(--background-base))`}
          stroke="var(--background-base)"
          strokeWidth="1"
        />
      ))}
      {preview.labels.map((label, index) => (
        <g key={index} fill="var(--text-strong)">
          <text x={label.x} y={label.y} fontSize="11" fontWeight="600">
            {label.name}
          </text>
          <text x={label.x} y={label.y + 16} fontSize="11">
            {label.size}
          </text>
        </g>
      ))}
    </svg>
  )
}
