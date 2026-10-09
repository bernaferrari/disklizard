import { Button } from "@/components/dl/button"
import { Icon, type IconName } from "@/components/dl/icon"
import { motion, useReducedMotion } from "framer-motion"
import { useEffect, useRef, type ReactNode } from "react"
import type { DiskScanNode } from "./types"
import { formatBytes } from "./format"
import { diskLanguageText, useLanguage } from "./runtime"

export function DriveFallback(props: {
  loading: boolean
  error?: string
  onChoose: () => void
}) {
  const language = useLanguage()
  return (
    <div className="flex min-h-full flex-col items-center justify-center px-8 py-16 text-center">
      {props.loading ? (
        <div className="mb-3 flex items-center gap-3 rounded-[10px] border-0 bg-surface-raised-base p-[18px] shadow-none">
          <span className="size-9 animate-pulse rounded-lg bg-[color-mix(in_oklch,var(--surface-raised-strong)_70%,var(--background-base))] shadow-[0_0_0_1px_color-mix(in_oklch,var(--text-strong)_10%,transparent)]" />
          <span className="min-w-0 flex-1">
            <span className="block h-3.5 w-36 rounded-sm bg-surface-raised-base" />
            <span className="mt-2 block h-3 w-52 rounded-sm bg-surface-raised-base/70" />
          </span>
          <span className="hidden h-1.5 w-[148px] rounded-full bg-surface-raised-base sm:block" />
          <span className="text-13-regular text-text-weaker">
            {language.t("disk.drive.reading")}
          </span>
        </div>
      ) : (
        <>
          <span className="grid size-11 place-items-center rounded-full bg-surface-raised-base text-text-weak">
            <Icon name="folder" className="size-4" />
          </span>
          <h2 className="text-14-medium mt-4 tracking-[-0.015em] text-text-strong">
            {props.error
              ? language.t("disk.drive.readFailed")
              : language.t("disk.drive.none")}
          </h2>
          <p className="text-13-regular mt-1 max-w-[30ch] leading-relaxed text-text-weak">
            {props.error ?? language.t("disk.drive.pickFolder")}
          </p>
          <Button
            data-disk-primary-action
            className="mt-4 min-h-11 min-w-11"
            variant="secondary"
            size="small"
            icon="folder-add-left"
            onClick={props.onChoose}
          >
            {language.t("disk.drive.scanFolder")}
          </Button>
        </>
      )}
    </div>
  )
}

export type IndexEmptyKind =
  | "folder"
  | "search"
  | "developer"
  | "recommendations"
  | "recent"

export function indexEmptyCopy(kind: IndexEmptyKind) {
  if (kind === "search") {
    return {
      icon: "magnifying-glass" as const,
      title: diskLanguageText("disk.empty.search.title"),
      body: diskLanguageText("disk.empty.search.body"),
    }
  }
  if (kind === "developer") {
    return {
      icon: "code-lines" as const,
      title: diskLanguageText("disk.empty.developer.title"),
      body: diskLanguageText("disk.empty.developer.body"),
    }
  }
  if (kind === "recommendations") {
    return {
      icon: "shield" as const,
      title: diskLanguageText("disk.empty.recommendations.title"),
      body: diskLanguageText("disk.empty.recommendations.body"),
    }
  }
  if (kind === "recent") {
    return {
      icon: "reset" as const,
      title: diskLanguageText("disk.empty.recent.title"),
      body: diskLanguageText("disk.empty.recent.body"),
    }
  }
  return {
    icon: "folder" as const,
    title: diskLanguageText("disk.drive.emptyFolder"),
    body: diskLanguageText("disk.drive.noItems"),
  }
}

export function IndexEmpty(props: {
  kind: IndexEmptyKind
  title?: string
  body?: string
  actionLabel?: string
  onReset: () => void
}) {
  const language = useLanguage()
  const copy = indexEmptyCopy(props.kind)
  const filtered = props.kind !== "folder"
  return (
    <div className="flex min-h-full flex-col items-center justify-center px-8 py-8 text-center">
      <span className="grid size-11 place-items-center rounded-full bg-surface-raised-base text-text-weak">
        <Icon name={copy.icon} className="size-4" />
      </span>
      <h3 className="text-14-medium mt-4 tracking-[-0.015em] text-text-strong">
        {props.title ?? copy.title}
      </h3>
      <p className="text-13-regular mt-1 max-w-[30ch] leading-relaxed text-text-weak">
        {props.body ?? copy.body}
      </p>
      {filtered ? (
        <Button
          className="mt-4 min-h-11 min-w-11"
          size="small"
          variant="secondary"
          onClick={props.onReset}
        >
          {props.actionLabel ?? language.t("disk.common.contents")}
        </Button>
      ) : null}
    </div>
  )
}

export function Placeholder(props: {
  icon: IconName
  title: string
  body: string
  actions?: ReactNode
}) {
  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-5 grid size-12 place-items-center rounded-full bg-surface-raised-base shadow-[0_0_0_1px_rgb(127_127_127/0.1),0_8px_24px_rgb(0_0_0/0.06)]">
          <Icon name={props.icon} className="size-5 text-text-weak" />
        </div>
        <h2 className="text-14-medium tracking-[-0.015em] text-text-strong">
          {props.title}
        </h2>
        <p className="text-13-regular mt-1 leading-relaxed text-text-weak">
          {props.body}
        </p>
        {props.actions ? (
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {props.actions}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export type CenterOverlayBehavior = {
  canOpen: boolean
  inventoryOnly: boolean
  reviewOnlyCopy?: string
}

/**
 * Deep inventory records deliberately have no materialized map subtree. Keep
 * their overlay actionless instead of advertising an Enter/Open path which
 * cannot resolve to a visual child tree.
 */
export function centerOverlayBehavior(
  node: DiskScanNode | null,
  canOpen: boolean,
  inventoryOnly: boolean
): CenterOverlayBehavior {
  const isInventoryOnly = inventoryOnly && !!node
  return {
    canOpen: !!node?.isDir && !isInventoryOnly && canOpen,
    inventoryOnly: isInventoryOnly,
    ...(isInventoryOnly
      ? { reviewOnlyCopy: diskLanguageText("disk.drive.inventoryOnly") }
      : {}),
  }
}

/**
 * The ring's hole is the readout: it names what the number measures, and
 * follows the pointer so the answer appears where the eye already is.
 */
export function CenterOverlay(props: {
  node: DiskScanNode | null
  hovered?: DiskScanNode | null
}) {
  const reducedMotion = useReducedMotion()
  const shown = props.hovered ?? props.node
  // A new folder's total waits until the map has carried it into the
  // center; hover readouts stay instant.
  const lastNodePath = useRef(props.node?.path)
  const arriving = !props.hovered && lastNodePath.current !== props.node?.path
  useEffect(() => {
    lastNodePath.current = props.node?.path
  })
  const [amount, unit] = shown ? formatBytes(shown.size).split(" ") : []
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center">
      <div className="max-w-[min(13cqw,170px)] text-center @max-[399px]:max-w-[30cqw]">
        {shown ? (
          <motion.div
            key={shown.path}
            initial={{ opacity: reducedMotion ? 1 : arriving ? 0 : 0.35 }}
            animate={{ opacity: 1 }}
            transition={
              reducedMotion
                ? { duration: 0 }
                : arriving
                  ? { delay: 0.32, duration: 0.22 }
                  : { duration: 0.12 }
            }
          >
            <p className="text-[clamp(24px,4.6cqw,38px)] leading-none font-medium tracking-[-0.04em] whitespace-nowrap text-text-strong tabular-nums">
              {amount}
              <span className="mt-1.5 block text-[15px] tracking-normal text-text-weak">
                {unit}
              </span>
            </p>
          </motion.div>
        ) : null}
      </div>
    </div>
  )
}
