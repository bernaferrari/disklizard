import { Button } from "@/components/dl/button"
import { Icon } from "@/components/dl/icon"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { useRef } from "react"
import {
  File,
  Folder,
  FolderOpen,
  FolderSearch,
  Image,
  ExternalLink,
} from "lucide-react"
import type { DiskFilePreview, DiskScanNode } from "./types"
import { formatBytes, formatLastChanged } from "./format"
import { FadeSettle, Spin } from "./motion-ui"
import { StorageAccountingFacts } from "./StorageAccounting"
import { diskLanguageText, useLanguage } from "./runtime"
import { itemIdentity } from "./item-identity"

function unsupportedCopy(
  preview: Extract<DiskFilePreview, { kind: "unsupported" }>
) {
  if (preview.reason === "too-large") {
    return {
      title: diskLanguageText("disk.preview.tooLarge.title"),
      detail: diskLanguageText("disk.preview.tooLarge.body"),
    }
  }
  if (preview.reason === "binary") {
    return {
      title: diskLanguageText("disk.preview.binary.title"),
      detail: diskLanguageText("disk.preview.binary.body"),
    }
  }
  return {
    title: diskLanguageText("disk.preview.unsupported.title"),
    detail: diskLanguageText("disk.preview.unsupported.body"),
  }
}

export function PreviewDialog(props: {
  open: boolean
  /** Bridge while index.tsx migrates `phase` → boolean `open` (drop once landed). */
  node: DiskScanNode
  preview?: DiskFilePreview
  loading: boolean
  error?: string
  position: number
  total: number
  onClose: () => void
  onPrevious?: () => void
  onNext?: () => void
  onReveal: () => void
  revealLabel: string
  systemPreviewLabel?: string
  onSystemPreview?: () => void
  onOpen: () => void
}) {
  const language = useLanguage()
  const panelRef = useRef<HTMLDivElement | null>(null)
  const open = props.open ?? false
  const HeaderIcon = props.node.isDir
    ? Folder
    : props.preview?.kind === "image"
      ? Image
      : File
  const largest = [...props.node.children]
    .filter((child) => !child.isOther)
    .toSorted((a, b) => b.size - a.size)
    .slice(0, 5)
  const loadedPreview =
    !props.loading && !props.error && !props.node.isDir
      ? props.preview
      : undefined

  const renderLoadedPreview = (preview: DiskFilePreview) => {
    if (preview.kind === "image") {
      return (
        <div className="grid size-full place-items-center overflow-auto bg-surface-raised-strong p-5 sm:p-8">
          <FadeSettle
            className="max-h-full max-w-full rounded-xl object-contain shadow-[0_0_0_1px_rgb(127_127_127/0.16),0_18px_50px_rgb(0_0_0/0.18)]"
            src={preview.dataUrl}
            alt={language.t("disk.preview.imageLabel", {
              name: props.node.name,
            })}
            decoding="async"
            draggable={false}
          />
        </div>
      )
    }
    if (preview.kind === "text") {
      return (
        <div className="flex size-full min-h-0 flex-col">
          <div className="text-13-regular flex shrink-0 items-center justify-between border-b border-[var(--dl-separator)] px-4 py-2 text-text-weaker">
            <span>
              {language.t("disk.preview.lines", {
                count: preview.text.split("\n").length.toLocaleString(),
              })}
            </span>
            {preview.truncated ? (
              <span className="text-13-semibold rounded-full bg-surface-raised-base px-2 py-1 text-text-weak">
                {language.t("disk.preview.truncated")}
              </span>
            ) : null}
          </div>
          <pre
            className="min-h-0 flex-1 overflow-auto p-4 font-mono text-[12px] leading-[1.65] text-text-base outline-none selection:bg-[oklch(0.72_0.12_176/0.24)] sm:p-5"
            tabIndex={0}
            aria-label={language.t("disk.preview.textLabel", {
              name: props.node.name,
            })}
          >
            {preview.text}
          </pre>
        </div>
      )
    }
    if (preview.kind === "pdf") {
      return (
        <iframe
          className="size-full border-0 bg-surface-raised-strong outline-none focus-visible:ring-2 focus-visible:ring-text-weak focus-visible:ring-inset"
          src={preview.dataUrl}
          title={language.t("disk.preview.pdfLabel", { name: props.node.name })}
          tabIndex={0}
        />
      )
    }
    const copy = unsupportedCopy(preview)
    return (
      <div className="grid size-full place-items-center p-8 text-center">
        <div className="max-w-sm">
          <span className="mx-auto grid size-12 place-items-center rounded-full bg-surface-raised-base text-text-weak">
            <Icon name="open-file" className="size-4.5" />
          </span>
          <h3 className="text-14-semibold mt-4 text-text-strong">
            {copy.title}
          </h3>
          <p className="text-13-regular mt-2 leading-relaxed text-text-weak">
            {copy.detail}
          </p>
        </div>
      </div>
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) props.onClose()
      }}
    >
      <DialogContent
        aria-labelledby="preview-title"
        aria-describedby="preview-description"
        showCloseButton={false}
        ref={panelRef}
        initialFocus={() => panelRef.current}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return
          if (event.key === "ArrowLeft" && props.onPrevious) {
            event.preventDefault()
            props.onPrevious()
            return
          }
          if (event.key === "ArrowRight" && props.onNext) {
            event.preventDefault()
            props.onNext()
          }
        }}
        className="flex h-[min(760px,calc(100dvh-24px))] w-[calc(100%-24px)] max-w-5xl flex-col gap-0 overflow-hidden rounded-2xl border-0 bg-[var(--dl-popover)] p-0 shadow-[0_0_0_0.5px_rgb(255_255_255/0.1),0_30px_90px_rgb(0_0_0/0.5)] ring-0 sm:h-[min(760px,calc(100dvh-48px))] sm:w-[calc(100%-48px)] sm:max-w-5xl"
      >
        <header className="flex shrink-0 items-start gap-3 border-b border-[var(--dl-separator)] px-4 py-3.5 sm:px-5">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--dl-well)] text-text-weak">
            <HeaderIcon className="size-4" strokeWidth={1.75} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-medium text-text-weak">
              {language.t("disk.preview.heading")}
            </p>
            <h2
              id="preview-title"
              className="mt-0.5 truncate text-[16px] font-semibold tracking-[-0.015em] text-text-strong"
            >
              {itemIdentity(props.node).reviewTitle}
            </h2>
            <p
              id="preview-description"
              className="mt-0.5 truncate text-[12px] text-text-weak"
              title={props.node.path}
            >
              {props.node.path}
            </p>
          </div>
          <Button
            className="min-h-9 min-w-9"
            size="small"
            variant="ghost"
            icon="close"
            onClick={props.onClose}
            aria-label={language.t("disk.preview.close")}
          />
        </header>

        <main className="relative min-h-0 flex-1 overflow-hidden bg-[color-mix(in_oklch,var(--background-base)_60%,var(--dl-popover))]">
          {props.loading ? (
            <div
              className="grid size-full place-items-center"
              role="status"
              aria-live="polite"
            >
              <div className="flex flex-col items-center gap-3 text-text-weak">
                <Spin className="size-5 rounded-full border border-[var(--dl-separator)] border-t-current" />
                <p className="text-13-regular">
                  {language.t("disk.preview.loading")}
                </p>
              </div>
            </div>
          ) : null}

          {!props.loading && props.error ? (
            <div
              className="grid size-full place-items-center p-8 text-center"
              role="alert"
            >
              <div className="max-w-sm">
                <span className="mx-auto grid size-12 place-items-center rounded-full bg-[color-mix(in_oklch,var(--dl-danger)_14%,transparent)] text-[var(--dl-danger)]">
                  <Icon name="warning" className="size-4.5" />
                </span>
                <h3 className="text-14-semibold mt-4 text-text-strong">
                  {language.t("disk.preview.readError")}
                </h3>
                <p className="text-13-regular mt-2 leading-relaxed text-text-weak">
                  {props.error}
                </p>
              </div>
            </div>
          ) : null}

          {!props.loading && !props.error && props.node.isDir ? (
            <div className="flex size-full min-h-0 flex-col overflow-auto p-5 sm:p-8">
              <div className="mx-auto w-full max-w-2xl">
                <div className="flex items-start">
                  <div className="min-w-0">
                    <h3 className="text-14-semibold text-text-strong">
                      {language.t("disk.preview.folderSummary")}
                    </h3>
                    <p className="text-13-regular mt-1 leading-relaxed text-text-weak">
                      {language.t("disk.preview.folderCount", {
                        count: props.node.children.length.toLocaleString(),
                        items: language.plural(
                          "disk.count.itemNoun",
                          props.node.children.length
                        ),
                        size: formatBytes(props.node.size),
                      })}
                    </p>
                    <p className="text-13-regular mt-2 leading-relaxed text-text-weaker">
                      {language.t("disk.preview.folderBody")}
                    </p>
                  </div>
                </div>

                {largest.length ? (
                  <section
                    className="mt-6"
                    aria-labelledby="preview-largest-items"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <h3
                        id="preview-largest-items"
                        className="text-[13px] font-medium text-text-weak"
                      >
                        {language.t("disk.preview.largest")}
                      </h3>
                      <span className="text-13-regular text-text-weaker tabular-nums">
                        {language.t("disk.preview.total", {
                          count: formatBytes(props.node.size),
                        })}
                      </span>
                    </div>
                    <ul className="mt-2 divide-y divide-border-weaker-base border-y border-[var(--dl-separator)]">
                      {largest.map((child) => (
                        <li
                          key={child.path}
                          className="flex min-w-0 items-center gap-3 py-3"
                        >
                          {child.isDir ? (
                            <Folder
                              className="size-4 shrink-0 text-text-weak"
                              strokeWidth={1.75}
                              aria-hidden
                            />
                          ) : (
                            <File
                              className="size-4 shrink-0 text-text-weak"
                              strokeWidth={1.75}
                              aria-hidden
                            />
                          )}
                          <span
                            className="min-w-0 flex-1 truncate text-[13px] text-text-strong"
                            title={child.name}
                          >
                            {child.name}
                          </span>
                          <span className="shrink-0 text-[13px] text-text-weak tabular-nums">
                            {formatBytes(child.size)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
              </div>
            </div>
          ) : null}

          {loadedPreview ? renderLoadedPreview(loadedPreview) : null}
        </main>

        <footer className="flex shrink-0 flex-wrap items-center gap-3 border-t border-[var(--dl-separator)] bg-surface-raised-strong px-4 py-3 sm:px-5">
          {!props.node.isDir ? (
            <div
              className="flex shrink-0 items-center gap-1"
              role="group"
              aria-label={language.t("disk.preview.navigation")}
            >
              <Button
                className="min-h-9 min-w-9"
                size="small"
                variant="ghost"
                icon="chevron-left"
                disabled={!props.onPrevious}
                onClick={props.onPrevious}
                aria-label={language.t("disk.preview.previous")}
                title={language.t("disk.preview.previous")}
              />
              <span className="text-13-regular min-w-12 text-center text-text-weaker tabular-nums">
                {language.t("disk.preview.position", {
                  current: props.position,
                  total: props.total,
                })}
              </span>
              <Button
                className="min-h-9 min-w-9"
                size="small"
                variant="ghost"
                icon="chevron-right"
                disabled={!props.onNext}
                onClick={props.onNext}
                aria-label={language.t("disk.preview.next")}
                title={language.t("disk.preview.next")}
              />
            </div>
          ) : null}
          <div className="min-w-0 flex-1">
            <p className="text-13-semibold text-text-strong tabular-nums">
              {formatBytes(props.node.size)}
            </p>
            <p className="text-13-regular mt-0.5 text-text-weaker">
              {props.node.modifiedAt
                ? language.t("disk.preview.changedLocal", {
                    changed: formatLastChanged(props.node.modifiedAt),
                  })
                : language.t("disk.preview.local")}
            </p>
            <StorageAccountingFacts node={props.node} className="mt-1" />
          </div>
          <Button
            className="min-h-9 min-w-9"
            size="small"
            variant="ghost"
            onClick={props.onReveal}
          >
            <FolderSearch className="size-3.5" strokeWidth={1.75} aria-hidden />
            {props.revealLabel}
          </Button>
          {props.onSystemPreview && props.systemPreviewLabel ? (
            <Button
              className="min-h-9 min-w-9"
              size="small"
              variant="ghost"
              icon="eye"
              onClick={props.onSystemPreview}
            >
              {props.systemPreviewLabel}
            </Button>
          ) : null}
          <Button
            className="min-h-9 min-w-9"
            size="small"
            variant="primary"
            onClick={props.onOpen}
          >
            {props.node.isDir ? (
              <FolderOpen className="size-3.5" strokeWidth={1.75} aria-hidden />
            ) : (
              <ExternalLink
                className="size-3.5"
                strokeWidth={1.75}
                aria-hidden
              />
            )}
            {language.t(
              props.node.isDir
                ? "disk.common.exploreFolder"
                : "disk.preview.openDefault"
            )}
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  )
}
