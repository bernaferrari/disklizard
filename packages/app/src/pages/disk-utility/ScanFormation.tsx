import { Button } from "@/components/dl/button"
import { useMemo } from "react"
import { motion } from "framer-motion"
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
  const progress = useMemo(() => determinateScanProgress(props.pct), [props.pct])
  const bytes = shortBytes(props.bytes)
  return (
    <section
      className="flex w-full max-w-sm flex-col items-center text-center"
      aria-label={language.t("disk.scan.label", { label: props.label })}
    >
      <div
        className="mb-5 size-10 text-text-weak"
        role="progressbar"
        aria-label={language.t("disk.scan.progressLabel", { label: props.label })}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress ?? undefined}
        aria-valuetext={
          progress === null
            ? language.t("disk.scan.progressIndeterminate", { bytes, files: formatCount(props.files) })
            : language.t("disk.scan.progressValue", {
                percent: Math.round(progress),
                bytes,
                files: formatCount(props.files),
              })
        }
      >
        <svg viewBox="0 0 40 40" className="size-full" aria-hidden="true">
          <circle cx="20" cy="20" r="16" fill="none" stroke="var(--border-weaker-base)" strokeWidth="2.5" />
          <motion.circle
            cx="20"
            cy="20"
            r="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            pathLength={100}
            strokeLinecap="round"
            strokeDasharray={`${progress ?? 25} 100`}
            transform="rotate(-90 20 20)"
            initial={{ rotate: 0 }}
            animate={{ rotate: progress === null ? 360 : -90 }}
            transition={
              progress === null ? { duration: 1.2, ease: "linear", repeat: Infinity } : { duration: 0 }
            }
            style={{ transformOrigin: "20px 20px" }}
          />
        </svg>
      </div>
      <h2 className="max-w-full truncate text-20-medium text-text-strong" title={props.label}>
        {language.t("disk.scan.label", { label: props.label })}
      </h2>
      {progress !== null ? (
        <p className="mt-2 text-13-medium tabular-nums text-text-strong">
          {language.t("disk.scan.estimatedPercent", { percent: Math.round(progress) })}
        </p>
      ) : null}
      <p className="mt-2 text-13-regular tabular-nums text-text-weak" title={props.currentPath}>
        {language.t("disk.drive.scanningSummary", { files: formatCount(props.files), bytes })}
      </p>
      <Button className="mt-6" variant="secondary" size="small" onClick={props.onCancel}>
        {language.t("disk.common.cancelScan")}
      </Button>
    </section>
  )
}
