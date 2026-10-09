import { useMemo } from "react"
import { motion, useReducedMotion } from "framer-motion"
import { formatBytes, formatCount } from "./format"
import { useLanguage } from "./runtime"
import { determinateScanProgress } from "./scan-progress"
import { DiscoveryList, LiveScanRing, type ScanDiscovery } from "./live-scan"

type ScanFormationProps = {
  discoveries?: readonly ScanDiscovery[]
  totalBytes?: number
  label: string
  files: number
  bytes: number
  currentPath: string
  pct: number | null
  onCancel: () => void
}

const RING =
  "conic-gradient(from 0deg, oklch(0.8 0.18 150), oklch(0.78 0.14 195), oklch(0.66 0.18 256), oklch(0.64 0.2 300), oklch(0.7 0.2 350), oklch(0.74 0.17 40), oklch(0.86 0.16 95), oklch(0.8 0.18 150))"

/** One calm, alive thing to watch while the scanner works, and one way out. */
export function ScanFormation(props: ScanFormationProps) {
  const language = useLanguage()
  const reducedMotion = useReducedMotion()
  const progress = useMemo(
    () => determinateScanProgress(props.pct),
    [props.pct]
  )
  const [amount, unit] = formatBytes(props.bytes).split(" ")
  return (
    <section
      className="flex w-full max-w-md flex-col items-center text-center"
      aria-label={language.t("disk.scan.label", { label: props.label })}
    >
      <div
        className="relative mb-8 size-[240px]"
        role="progressbar"
        aria-label={language.t("disk.scan.progressLabel", {
          label: props.label,
        })}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress ?? undefined}
        aria-valuetext={
          progress === null
            ? language.t("disk.scan.progressIndeterminate", {
                bytes: formatBytes(props.bytes),
                files: formatCount(props.files),
              })
            : language.t("disk.scan.progressValue", {
                percent: Math.round(progress),
                bytes: formatBytes(props.bytes),
                files: formatCount(props.files),
              })
        }
      >
        {props.discoveries?.length ? (
          <LiveScanRing
            discoveries={props.discoveries}
            totalBytes={props.totalBytes ?? 0}
          >
            <div>
              <p className="text-[40px] leading-none font-semibold tracking-[-0.04em] text-text-strong tabular-nums">
                {amount}
              </p>
              <p className="mt-1.5 text-[15px] text-text-weak">{unit}</p>
            </div>
          </LiveScanRing>
        ) : (
          <>
            <div className="absolute inset-0 rounded-full bg-[var(--dl-well)]" />
            {progress === null ? (
              <motion.div
                className="absolute inset-0 rounded-full"
                style={{
                  background: RING,
                  mask: "conic-gradient(from 0deg, transparent 0 8%, black 70%, transparent 100%)",
                  WebkitMask:
                    "conic-gradient(from 0deg, transparent 0 8%, black 70%, transparent 100%)",
                }}
                animate={{ rotate: reducedMotion ? 0 : 360 }}
                transition={
                  reducedMotion
                    ? { duration: 0 }
                    : { duration: 1.8, ease: "linear", repeat: Infinity }
                }
              />
            ) : (
              <div
                className="absolute inset-0 rounded-full transition-[mask] duration-300"
                style={{
                  background: RING,
                  mask: `conic-gradient(black ${progress}%, transparent 0)`,
                  WebkitMask: `conic-gradient(black ${progress}%, transparent 0)`,
                }}
              />
            )}
            <div className="absolute inset-[26px] grid place-items-center rounded-full bg-background-base">
              <div>
                <p className="text-[40px] leading-none font-semibold tracking-[-0.04em] text-text-strong tabular-nums">
                  {amount}
                </p>
                <p className="mt-1.5 text-[15px] text-text-weak">{unit}</p>
              </div>
            </div>
          </>
        )}
      </div>
      <h2
        className="max-w-full truncate pb-0.5 text-[20px] leading-7 font-semibold tracking-[-0.02em] text-text-strong"
        title={props.label}
      >
        {language.t("disk.scan.label", { label: props.label })}
      </h2>
      <p className="mt-1.5 text-[13px] text-text-weak tabular-nums">
        {progress !== null
          ? `${language.t("disk.scan.estimatedPercent", {
              percent: Math.round(progress),
            })} · `
          : ""}
        {language.t("disk.drive.scanningSummary", {
          files: formatCount(props.files),
          bytes: formatBytes(props.bytes),
        })}
      </p>
      <p
        className="mt-3 h-4 max-w-full truncate font-mono text-[11px] text-text-weaker"
        title={props.currentPath}
      >
        {props.currentPath}
      </p>
      {props.discoveries?.length ? (
        <div className="mt-6 w-full max-w-[300px]">
          <DiscoveryList
            discoveries={props.discoveries}
            totalBytes={props.totalBytes ?? 0}
          />
        </div>
      ) : null}
      <button
        type="button"
        className="mt-7 inline-flex h-8 items-center rounded-full bg-[var(--dl-well-strong)] px-4 text-[13px] font-medium text-text-strong transition-[filter] outline-none hover:brightness-125 focus-visible:ring-2 focus-visible:ring-[var(--dl-focus)]"
        onClick={props.onCancel}
      >
        {language.t("disk.common.cancelScan")}
      </button>
    </section>
  )
}
