import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import type { DiskScanProgress } from "@/context/platform"
import { formatCount, shortBytes, truncatePath } from "./format"
import { SIZE_BAR_TONES } from "./ui-tokens"

type ScanFormationProps = {
  label: string
  files: number
  bytes: number
  currentPath: string
  pct: number | null
  discoveries: readonly NonNullable<DiskScanProgress["discovery"]>[]
  onCancel: () => void
}

type OrbitSegment = {
  branch: NonNullable<DiskScanProgress["discovery"]>
  start: number
  length: number
  color: string
}

export function ScanFormation(props: ScanFormationProps) {
  const [elapsedMs, setElapsedMs] = createSignal(0)
  let startedAt = 0
  let timer: ReturnType<typeof setInterval> | undefined

  onMount(() => {
    startedAt = performance.now()
    timer = setInterval(() => setElapsedMs(performance.now() - startedAt), 500)
  })
  onCleanup(() => clearInterval(timer))

  const leadingBranches = createMemo(() => props.discoveries.slice(0, 8))
  const itemRate = createMemo(() => {
    const seconds = elapsedMs() / 1000
    return seconds > 0.75 ? Math.round(props.files / seconds) : 0
  })
  const elapsed = createMemo(() => {
    const seconds = Math.max(0, Math.floor(elapsedMs() / 1000))
    return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  })
  const orbitSegments = createMemo<OrbitSegment[]>(() => {
    const branches = leadingBranches()
    if (!branches.length) return []
    const gap = 1.15
    const available = 100 - gap * branches.length
    const total = Math.max(1, branches.reduce((sum, branch) => sum + branch.size, 0))
    const raw = branches.map((branch) => Math.max(2.4, (branch.size / total) * available))
    const scale = available / raw.reduce((sum, value) => sum + value, 0)
    let cursor = 0
    return branches.map((branch, index) => {
      const length = raw[index] * scale
      const segment = { branch, start: cursor, length, color: SIZE_BAR_TONES[index % SIZE_BAR_TONES.length] }
      cursor += length + gap
      return segment
    })
  })

  return (
    <section class="w-full max-w-7xl" aria-label={`Scanning ${props.label}`}>
      <header class="flex flex-wrap items-end justify-between gap-5 border-b border-border-weaker-base pb-5">
        <div class="min-w-0">
          <div class="mb-2 flex items-center gap-2 text-9-semibold uppercase tracking-[0.16em] text-text-weak">
            <span class="dl-scan-beacon size-1.5 rounded-full bg-[oklch(0.74_0.13_176)]" />
            Mapping live
          </div>
          <h2 class="truncate text-[clamp(32px,4vw,52px)] font-medium leading-none tracking-[-0.05em] text-text-strong">
            {props.label}
          </h2>
        </div>
        <div class="flex items-center gap-5">
          <p class="hidden text-right text-9-regular leading-relaxed text-text-weaker sm:block">
            Read only<br />Nothing is changed
          </p>
          <Button variant="secondary" size="large" icon="close" onClick={props.onCancel}>
            Stop and discard
          </Button>
        </div>
      </header>

      <div class="relative h-1 overflow-hidden bg-surface-raised-strong" aria-hidden="true">
        <div
          class="dl-scan-progress absolute inset-y-0 left-0 bg-[oklch(0.74_0.13_176)]"
          classList={{ "dl-scan-indeterminate": props.pct == null }}
          style={{ width: props.pct == null ? undefined : `${Math.max(0.8, props.pct)}%` }}
        />
      </div>

      <div class="grid min-h-[500px] lg:grid-cols-[minmax(420px,0.92fr)_minmax(380px,1.08fr)]">
        <div class="relative grid min-h-[430px] place-items-center overflow-hidden border-b border-border-weaker-base py-7 lg:border-b-0 lg:border-r">
          <ScanAperture
            bytes={props.bytes}
            files={props.files}
            pct={props.pct}
            segments={orbitSegments()}
          />
          <div class="absolute bottom-5 left-5 right-5 flex items-center justify-between text-9-regular text-text-weaker sm:left-8 sm:right-8">
            <span>{leadingBranches().length || "No"} roots resolved</span>
            <span class="tabular-nums">{elapsed()}</span>
          </div>
        </div>

        <div class="flex min-w-0 flex-col px-5 py-7 sm:px-8">
          <div class="grid grid-cols-3 gap-4 border-b border-border-weaker-base pb-6">
            <ScanMetric label="Objects" value={formatCount(props.files)} />
            <ScanMetric label="Observed" value={props.bytes > 0 ? shortBytes(props.bytes) : "—"} />
            <ScanMetric label="Velocity" value={itemRate() > 0 ? `${formatCount(itemRate())}/s` : "Warming"} />
          </div>

          <div class="border-b border-border-weaker-base py-5">
            <div class="flex items-center gap-2 text-8-semibold uppercase tracking-[0.14em] text-text-weaker">
              <Icon name="folder" class="size-3" />
              Reading now
            </div>
            <p class="mt-2 min-h-10 break-words font-mono text-9-regular leading-relaxed text-text-weak" title={props.currentPath}>
              {props.currentPath ? truncatePath(props.currentPath, 112) : "Preparing filesystem access…"}
            </p>
          </div>

          <div class="min-h-0 flex-1 pt-5">
            <div class="flex items-baseline justify-between gap-4">
              <h3 class="text-12-semibold text-text-strong">Resolved branches</h3>
              <span class="text-8-regular text-text-weaker">largest first</span>
            </div>
            <Show
              when={leadingBranches().length > 0}
              fallback={
                <div class="mt-6 border-l border-[oklch(0.74_0.13_176)] py-1 pl-4">
                  <p class="text-11-semibold text-text-strong">Opening the filesystem</p>
                  <p class="mt-1 max-w-[46ch] text-9-regular leading-relaxed text-text-weak">
                    The first trustworthy roots will appear here while the rest continue in parallel.
                  </p>
                </div>
              }
            >
              <ol class="mt-3" aria-label="Largest completed scan branches">
                <For each={leadingBranches().slice(0, 6)}>
                  {(branch, index) => (
                    <li class="dl-scan-branch grid grid-cols-[8px_minmax(0,1fr)_auto] items-center gap-3 border-b border-border-weaker-base py-2.5 last:border-b-0">
                      <span
                        class="size-1.5 rounded-full"
                        style={{ background: SIZE_BAR_TONES[index() % SIZE_BAR_TONES.length] }}
                      />
                      <span class="truncate text-10-medium text-text-strong">{branch.name}</span>
                      <span class="text-9-medium tabular-nums text-text-weak">{shortBytes(branch.size)}</span>
                    </li>
                  )}
                </For>
              </ol>
            </Show>
          </div>
        </div>
      </div>

      <span class="sr-only" role="status">
        Scanning {props.label}. {formatCount(props.files)} items mapped. Use Stop and discard to cancel.
      </span>
    </section>
  )
}

function ScanAperture(props: {
  bytes: number
  files: number
  pct: number | null
  segments: readonly OrbitSegment[]
}) {
  const progress = () => Math.max(0.6, Math.min(100, props.pct ?? 8))
  return (
    <div class="relative size-[min(76vw,390px)]" aria-hidden="true">
      <svg class="size-full overflow-visible" viewBox="0 0 400 400">
        <circle cx="200" cy="200" r="166" fill="none" stroke="var(--border-weaker-base)" stroke-width="1" />
        <circle cx="200" cy="200" r="145" fill="none" stroke="var(--surface-raised-strong)" stroke-width="22" />
        <For each={props.segments}>
          {(segment) => (
            <circle
              class="dl-scan-orbit-segment"
              cx="200"
              cy="200"
              r="145"
              fill="none"
              stroke={segment.color}
              stroke-width="22"
              pathLength="100"
              stroke-dasharray={`${segment.length} ${100 - segment.length}`}
              stroke-dashoffset={`${-segment.start}`}
              transform="rotate(-90 200 200)"
            />
          )}
        </For>
        <circle cx="200" cy="200" r="114" fill="none" stroke="var(--border-weaker-base)" stroke-width="1" />
        <circle
          class="dl-scan-progress-ring"
          cx="200"
          cy="200"
          r="104"
          fill="none"
          stroke="oklch(0.74 0.13 176)"
          stroke-width="3"
          pathLength="100"
          stroke-dasharray={`${progress()} ${100 - progress()}`}
          transform="rotate(-90 200 200)"
        />
        <circle cx="200" cy="200" r="82" fill="var(--background-base)" stroke="var(--border-weaker-base)" stroke-width="1" />
        <g class="dl-scan-orbit-ticks" fill="var(--text-weaker)">
          <For each={Array.from({ length: 24 })}>
            {(_, index) => <rect x="199.5" y="52" width="1" height="5" transform={`rotate(${index() * 15} 200 200)`} />}
          </For>
        </g>
      </svg>
      <div class="absolute inset-0 grid place-content-center text-center">
        <span class="text-[clamp(26px,3.2vw,38px)] font-medium tracking-[-0.045em] tabular-nums text-text-strong">
          {props.bytes > 0 ? shortBytes(props.bytes) : "—"}
        </span>
        <span class="mt-1 text-8-semibold uppercase tracking-[0.16em] text-text-weaker">observed</span>
        <span class="mt-3 text-9-regular tabular-nums text-text-weak">{formatCount(props.files)} objects</span>
      </div>
    </div>
  )
}

function ScanMetric(props: { label: string; value: string }) {
  return (
    <div class="min-w-0">
      <p class="text-8-semibold uppercase tracking-[0.13em] text-text-weaker">{props.label}</p>
      <p class="mt-1.5 truncate text-13-medium tabular-nums text-text-strong">{props.value}</p>
    </div>
  )
}
