import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import type { DiskScanProgress } from "./types"
import { spectrumHue, spectrumTone, toneCss } from "./spectrum"
import { formatBytes } from "./format"

/**
 * The scanner reports each top-level item as it finishes. Drawing those as
 * they land turns waiting into watching the map assemble itself, at no extra
 * scanning cost.
 */

export type ScanDiscovery = NonNullable<DiskScanProgress["discovery"]>

const MAX_DISCOVERIES = 48

export function mergeDiscovery(
  list: readonly ScanDiscovery[] | undefined,
  discovery: ScanDiscovery | undefined
): readonly ScanDiscovery[] | undefined {
  if (!discovery || discovery.size <= 0) return list
  const current = list ?? []
  if (current.some((item) => item.path === discovery.path)) return current
  if (current.length >= MAX_DISCOVERIES) {
    const smallest = current.reduce(
      (index, item, next) =>
        item.size < current[index].size ? next : index,
      0
    )
    if (discovery.size <= current[smallest].size) return current
    return [
      ...current.slice(0, smallest),
      ...current.slice(smallest + 1),
      discovery,
    ]
  }
  return [...current, discovery]
}

type Segment = {
  item: ScanDiscovery
  start: number
  end: number
  color: string
}

function discoveryHue(path: string): number {
  let hash = 2166136261
  for (let i = 0; i < path.length; i++) {
    hash = Math.imul(hash ^ path.charCodeAt(i), 16777619)
  }
  return spectrumHue((hash >>> 0) / 4294967296)
}

export function scanDiscoverySegments(
  items: readonly ScanDiscovery[],
  total: number
): Segment[] {
  const discovered = items.reduce((sum, item) => sum + item.size, 0)
  // A folder scan has no capacity estimate. Reserve a quiet part of the ring
  // instead of turning the first completed folder into an apparent 100% scan.
  const denominator =
    total > 0
      ? Math.max(total, discovered, 1)
      : Math.max(discovered * 1.25, 1)
  let cursor = 0
  // Keep arrival order. Sorting by size moves every existing arc and changes
  // its color each time a larger folder finishes.
  return items.map((item) => {
    const start = cursor
    cursor += item.size / denominator
    return {
      item,
      start,
      end: cursor,
      color: toneCss(spectrumTone(discoveryHue(item.path), 0)),
    }
  })
}

export function LiveScanRing(props: {
  discoveries: readonly ScanDiscovery[]
  totalBytes: number
  size?: number
  children?: React.ReactNode
}) {
  const size = props.size ?? 240
  const center = size / 2
  const stroke = size * 0.12
  const radius = center - stroke / 2 - 2
  const parts = scanDiscoverySegments(props.discoveries, props.totalBytes)
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg
        viewBox={`0 0 ${size} ${size}`}
        className="absolute inset-0"
        aria-hidden
      >
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="var(--dl-well)"
          strokeWidth={stroke}
        />
        {parts.map((part) => {
          const gap = parts.length > 1 ? 0.004 : 0
          return (
            <Arc
              key={part.item.path}
              center={center}
              radius={radius}
              stroke={stroke}
              color={part.color}
              start={part.start + gap / 2}
              length={Math.max(0.0015, part.end - part.start - gap)}
            />
          )
        })}
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        {props.children}
      </div>
    </div>
  )
}

function Arc(props: {
  center: number
  radius: number
  stroke: number
  color: string
  start: number
  length: number
}) {
  const reducedMotion = useReducedMotion()
  const circumference = 2 * Math.PI * props.radius
  const length = props.length * circumference
  return (
    <motion.circle
      cx={props.center}
      cy={props.center}
      r={props.radius}
      fill="none"
      stroke={props.color}
      strokeWidth={props.stroke}
      transform={`rotate(-90 ${props.center} ${props.center})`}
      initial={
        reducedMotion
          ? false
          : {
              strokeDasharray: `0 ${circumference}`,
              strokeDashoffset: -props.start * circumference,
              opacity: 0,
            }
      }
      animate={{
        strokeDasharray: `${length} ${circumference}`,
        strokeDashoffset: -props.start * circumference,
        opacity: 1,
      }}
      transition={{
        duration: reducedMotion ? 0 : 0.36,
        ease: [0.22, 1, 0.36, 1],
      }}
    />
  )
}

/** The largest completed items, with each row retaining its identity as ranks change. */
export function DiscoveryList(props: {
  discoveries: readonly ScanDiscovery[]
  totalBytes: number
  limit?: number
}) {
  const reducedMotion = useReducedMotion()
  const parts = scanDiscoverySegments(props.discoveries, props.totalBytes)
    .toSorted((a, b) => b.item.size - a.item.size)
    .slice(0, props.limit ?? 5)
  return (
    <ul className="flex w-full flex-col gap-0.5">
      <AnimatePresence initial={false} mode="popLayout">
        {parts.map((part) => (
          <motion.li
            key={part.item.path}
            layout={reducedMotion ? false : "position"}
            initial={reducedMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{
              layout: {
                duration: reducedMotion ? 0 : 0.24,
                ease: [0.22, 1, 0.36, 1],
              },
              opacity: { duration: reducedMotion ? 0 : 0.16 },
            }}
            className="flex h-7 items-center gap-2.5 text-[13px]"
          >
            <span
              className={`size-2.5 shrink-0 ${part.item.isDir ? "rounded-full" : "rounded-[3px]"}`}
              style={{ background: part.color }}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate text-left text-text-strong">
              {part.item.name}
            </span>
            <span className="shrink-0 text-text-weak tabular-nums">
              {formatBytes(part.item.size)}
            </span>
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  )
}
