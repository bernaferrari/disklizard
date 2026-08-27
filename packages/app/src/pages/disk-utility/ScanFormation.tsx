import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Show, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { formatCount, shortBytes, truncatePath } from "./format"
import { useLanguage } from "./runtime"

type ScanFormationProps = {
  label: string
  files: number
  bytes: number
  currentPath: string
  pct: number | null
  onCancel: () => void
}

export function ScanFormation(props: ScanFormationProps) {
  const language = useLanguage()
  const [elapsedMs, setElapsedMs] = createSignal(0)
  let startedAt = 0
  let pausedAt = 0
  let pausedMs = 0
  let timer: ReturnType<typeof setInterval> | undefined

  const updateElapsed = () => setElapsedMs(performance.now() - startedAt - pausedMs)
  const startTimer = () => {
    if (!timer) timer = setInterval(updateElapsed, 500)
  }
  const stopTimer = () => {
    if (!timer) return
    clearInterval(timer)
    timer = undefined
  }

  onMount(() => {
    startedAt = performance.now()
    startTimer()
    const onVisibilityChange = () => {
      if (document.hidden) {
        pausedAt = performance.now()
        stopTimer()
        return
      }
      if (pausedAt) {
        pausedMs += performance.now() - pausedAt
        pausedAt = 0
      }
      updateElapsed()
      startTimer()
    }
    document.addEventListener("visibilitychange", onVisibilityChange)
    onCleanup(() => document.removeEventListener("visibilitychange", onVisibilityChange))
  })
  onCleanup(stopTimer)

  const elapsed = createMemo(() => {
    const seconds = Math.max(0, Math.floor(elapsedMs() / 1000))
    return seconds < 60
      ? language.t("disk.scan.elapsedSeconds", { seconds })
      : language.t("disk.scan.elapsedMinutes", { minutes: Math.floor(seconds / 60), seconds: seconds % 60 })
  })
  return (
    <section class="w-full max-w-7xl" aria-label={language.t("disk.scan.label", { label: props.label })}>
      <header class="flex min-h-[94px] flex-wrap items-end justify-between gap-5 border-b border-border-weaker-base pb-5">
        <div class="min-w-0">
          <div class="mb-2 flex items-center gap-2 text-13-semibold uppercase tracking-[0.16em] text-text-weak">
            <span class="dl-scan-beacon size-1.5 rounded-full bg-[oklch(0.74_0.13_252)]" />
            {language.t("disk.scan.scanning")}
          </div>
          <h2 class="truncate text-[clamp(32px,4vw,52px)] font-medium leading-none tracking-[-0.05em] text-text-strong">
            {props.label}
          </h2>
        </div>
        <div class="flex items-center gap-5">
          <p class="hidden text-right text-13-regular leading-relaxed text-text-weaker sm:block">
            {language.t("disk.scan.readOnly")}
            <br />
            {language.t("disk.scan.noChanges")}
          </p>
          <Button class="dl-touch-target" variant="secondary" size="large" icon="close" onClick={props.onCancel}>
            {language.t("disk.common.cancelScan")}
          </Button>
        </div>
      </header>

      <div class="grid min-h-[500px] lg:grid-cols-[minmax(420px,0.92fr)_minmax(380px,1.08fr)]">
        <div class="relative grid min-h-[430px] place-items-center overflow-hidden border-b border-border-weaker-base py-7 lg:border-b-0 lg:border-r">
          <ScanAperture bytes={props.bytes} files={props.files} pct={props.pct} />
        </div>

        <div class="flex min-w-0 flex-col px-5 py-7 sm:px-8">
          <div class="grid grid-cols-2 gap-x-8 border-b border-border-weaker-base pb-6">
            <ScanMetric label={language.t("disk.scan.filesScanned")} value={formatCount(props.files)} />
            <ScanMetric label={language.t("disk.scan.elapsed")} value={elapsed()} />
          </div>

          <div class="border-b border-border-weaker-base py-6">
            <div class="flex items-center gap-2 text-13-semibold uppercase tracking-[0.14em] text-text-weaker">
              <Icon name="folder" class="size-3" />
              {language.t("disk.scan.scanningNow")}
            </div>
            <p
              class="mt-2 line-clamp-2 min-h-10 break-words text-13-mono leading-relaxed text-text-weak"
              title={props.currentPath}
            >
              {props.currentPath ? truncatePath(props.currentPath, 112) : language.t("disk.scan.starting")}
            </p>
          </div>

          <div class="flex min-h-[190px] flex-1 items-center py-6">
            <div class="border-l border-[oklch(0.74_0.13_252)] py-1 pl-5">
              <h3 class="text-12-semibold text-text-strong">{language.t("disk.scan.building")}</h3>
              <p class="mt-2 max-w-[44ch] text-13-regular leading-relaxed text-text-weak">
                {language.t("disk.scan.buildingBody")}
              </p>
            </div>
          </div>
        </div>
      </div>

      <span class="sr-only" role="status">
        {language.t("disk.scan.status", { label: props.label, files: formatCount(props.files) })}
      </span>
    </section>
  )
}

function ScanAperture(props: { bytes: number; files: number; pct: number | null }) {
  const language = useLanguage()
  const progress = () => Math.max(0.6, Math.min(100, props.pct ?? 8))
  return (
    <div class="relative size-[clamp(260px,76vw,390px)]" aria-hidden="true">
      <svg class="size-full overflow-visible" viewBox="0 0 400 400">
        <circle cx="200" cy="200" r="166" fill="none" stroke="var(--border-weaker-base)" stroke-width="1" />
        <circle cx="200" cy="200" r="145" fill="none" stroke="var(--surface-raised-strong)" stroke-width="22" />
        <circle
          class="dl-scan-sweep"
          cx="200"
          cy="200"
          r="145"
          fill="none"
          stroke="oklch(0.74 0.13 252)"
          stroke-width="22"
          pathLength="100"
          stroke-dasharray="22 78"
          stroke-linecap="round"
        />
        <circle
          class="dl-scan-sweep"
          cx="200"
          cy="200"
          r="145"
          fill="none"
          stroke="oklch(0.74 0.13 252 / 0.35)"
          stroke-width="22"
          pathLength="100"
          stroke-dasharray="14 86"
          stroke-linecap="round"
          style="animation-delay:-0.18s"
        />
        <circle cx="200" cy="200" r="114" fill="none" stroke="var(--border-weaker-base)" stroke-width="1" />
        <circle
          class="dl-scan-progress-ring"
          cx="200"
          cy="200"
          r="104"
          fill="none"
          stroke="oklch(0.74 0.13 252)"
          stroke-width="3"
          pathLength="100"
          stroke-dasharray="100"
          stroke-dashoffset={`${100 - progress()}`}
          transform="rotate(-90 200 200)"
        />
        <circle
          cx="200"
          cy="200"
          r="82"
          fill="var(--background-base)"
          stroke="var(--border-weaker-base)"
          stroke-width="1"
        />
      </svg>
      <div class="absolute inset-0 grid place-content-center text-center">
        <span class="text-[clamp(26px,3.2vw,38px)] font-medium tracking-[-0.045em] tabular-nums text-text-strong">
          {props.bytes > 0 ? shortBytes(props.bytes) : "—"}
        </span>
        <span class="mt-1 text-13-semibold uppercase tracking-[0.16em] text-text-weaker">
          {language.t("disk.scan.scanned")}
        </span>
        <span class="mt-3 text-13-regular tabular-nums text-text-weak">
          {language.t("disk.scan.fileCount", { count: formatCount(props.files) })}
        </span>
      </div>
    </div>
  )
}

function ScanMetric(props: { label: string; value: string }) {
  return (
    <div class="min-w-0">
      <p class="text-13-semibold uppercase tracking-[0.13em] text-text-weaker">{props.label}</p>
      <p class="mt-1.5 truncate text-13-medium tabular-nums text-text-strong">{props.value}</p>
    </div>
  )
}
