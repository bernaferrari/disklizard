import { Button } from "@opencode-ai/ui/button"
import { Show, createMemo } from "solid-js"
import { formatCount, shortBytes } from "./format"
import { useLanguage } from "./runtime"
import { determinateScanProgress } from "./scan-progress"

type ScanFormationProps = {
  label: string
  files: number
  bytes: number
  currentPath: string
  pct: number | null
  onCancel: () => void
}

/** A waiting state, with one indication of activity and one way to stop. */
export function ScanFormation(props: ScanFormationProps) {
  const language = useLanguage()
  const progress = createMemo(() => determinateScanProgress(props.pct))
  const bytes = () => shortBytes(props.bytes)
  return (
    <section
      class="flex w-full max-w-sm flex-col items-center text-center"
      aria-label={language.t("disk.scan.label", { label: props.label })}
    >
      <div
        class="mb-5 size-10 text-text-weak"
        role="progressbar"
        aria-label={language.t("disk.scan.progressLabel", { label: props.label })}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress() ?? undefined}
        aria-valuetext={
          progress() === null
            ? language.t("disk.scan.progressIndeterminate", { bytes: bytes(), files: formatCount(props.files) })
            : language.t("disk.scan.progressValue", {
                percent: Math.round(progress()!),
                bytes: bytes(),
                files: formatCount(props.files),
              })
        }
      >
        <svg viewBox="0 0 40 40" class="size-full" aria-hidden="true">
          <circle cx="20" cy="20" r="16" fill="none" stroke="var(--border-weaker-base)" stroke-width="2.5" />
          <circle
            cx="20"
            cy="20"
            r="16"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            pathLength="100"
            stroke-linecap="round"
            stroke-dasharray={`${progress() ?? 25} 100`}
            transform="rotate(-90 20 20)"
            classList={{ "dl-scan-spinner": progress() === null }}
          />
        </svg>
      </div>
      <h2 class="max-w-full truncate text-20-medium text-text-strong" title={props.label}>
        {language.t("disk.scan.label", { label: props.label })}
      </h2>
      <Show when={progress() !== null}>
        <p class="mt-2 text-13-medium tabular-nums text-text-strong">
          {language.t("disk.scan.estimatedPercent", { percent: Math.round(progress()!) })}
        </p>
      </Show>
      <p class="mt-2 text-13-regular tabular-nums text-text-weak" title={props.currentPath}>
        {language.t("disk.drive.scanningSummary", { files: formatCount(props.files), bytes: bytes() })}
      </p>
      <Button class="mt-6" variant="secondary" size="small" onClick={props.onCancel}>
        {language.t("disk.common.cancelScan")}
      </Button>
    </section>
  )
}
