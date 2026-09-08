import { Button } from "@/components/dl/button"
import { Icon } from "@/components/dl/icon"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { useRef } from "react"
import type { DiskFilePreview, DiskScanNode } from "./types"
import { formatBytes, formatLastChanged } from "./format"
import type { SurfacePhase } from "./motion"
import { FadeSettle, Spin } from "./motion-ui"
import { StorageAccountingFacts } from "./StorageAccounting"
import { diskLanguageText, useLanguage } from "./runtime"

function unsupportedCopy(preview: Extract<DiskFilePreview, { kind: "unsupported" }>) {
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
  const largest = [...props.node.children]
    .filter((child) => !child.isOther)
    .toSorted((a, b) => b.size - a.size)
    .slice(0, 5)
  const loadedPreview = !props.loading && !props.error && !props.node.isDir ? props.preview : undefined

  const renderLoadedPreview = (preview: DiskFilePreview) => {
    if (preview.kind === "image") {
      return (
        <div className="grid size-full place-items-center overflow-auto bg-surface-raised-strong p-5 sm:p-8">
          <FadeSettle
            className="max-h-full max-w-full rounded-xl object-contain shadow-[0_0_0_1px_rgb(127_127_127/0.16),0_18px_50px_rgb(0_0_0/0.18)]"
            src={preview.dataUrl}
            alt={language.t("disk.preview.imageLabel", { name: props.node.name })}
            decoding="async"
            draggable={false}
          />
        </div>
      )
    }
    if (preview.kind === "text") {
      return (
        <div className="flex size-full min-h-0 flex-col">
          <div className="flex shrink-0 items-center justify-between border-b border-border-weaker-base px-4 py-2 text-13-regular text-text-weaker">
            <span>
              {language.t("disk.preview.lines", { count: preview.text.split("\n").length.toLocaleString() })}
            </span>
            {preview.truncated ? (
              <span className="rounded-full bg-surface-raised-base px-2 py-1 text-13-semibold text-text-weak">
                {language.t("disk.preview.truncated")}
              </span>
            ) : null}
          </div>
          <pre
            className="min-h-0 flex-1 overflow-auto p-4 font-mono text-[12px] leading-[1.65] text-text-base outline-none selection:bg-[oklch(0.72_0.12_176/0.24)] sm:p-5"
            tabIndex={0}
            aria-label={language.t("disk.preview.textLabel", { name: props.node.name })}
          >
            {preview.text}
          </pre>
        </div>
      )
    }
    if (preview.kind === "pdf") {
      return (
        <iframe
          className="size-full border-0 bg-surface-raised-strong outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-text-weak"
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
          <h3 className="mt-4 text-14-semibold text-text-strong">{copy.title}</h3>
          <p className="mt-2 text-13-regular leading-relaxed text-text-weak">{copy.detail}</p>
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
        className="flex h-[min(760px,calc(100dvh-24px))] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-surface-raised-strong gap-0 p-0 ring-0 shadow-[0_0_0_1px_rgb(127_127_127/0.13),0_28px_90px_rgb(0_0_0/0.28)] sm:h-[min(760px,calc(100dvh-48px))] sm:max-w-5xl"
      >
        <header className="flex shrink-0 items-start gap-3 border-b border-border-weaker-base px-4 py-3.5 sm:px-5">
          <span className="text-[color-mix(in_oklch,var(--dl-accent-strong)_54%,var(--text-strong))] grid size-10 shrink-0 place-items-center rounded-xl bg-[oklch(0.72_0.12_176/0.14)]">
            <Icon
              name={props.node.isDir ? "folder" : props.preview?.kind === "image" ? "photo" : "open-file"}
              className="size-4"
            />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-13-semibold uppercase tracking-[0.14em] text-text-weaker">
              {language.t("disk.preview.heading")}
            </p>
            <h2 id="preview-title" className="mt-0.5 truncate text-16-semibold tracking-[-0.02em] text-text-strong">
              {props.node.name}
            </h2>
            <p id="preview-description" className="mt-0.5 truncate text-13-mono text-text-weaker">
              {props.node.path}
            </p>
          </div>
          <Button
            className="min-h-11 min-w-11"
            size="small"
            variant="ghost"
            icon="close"
            onClick={props.onClose}
            aria-label={language.t("disk.preview.close")}
          />
        </header>

        <main className="relative min-h-0 flex-1 overflow-hidden bg-background-base/55">
          {props.loading ? (
            <div className="grid size-full place-items-center" role="status" aria-live="polite">
              <div className="flex flex-col items-center gap-3 text-text-weak">
                <Spin className="size-5 rounded-full border border-border-weaker-base border-t-current" />
                <p className="text-13-regular">{language.t("disk.preview.loading")}</p>
              </div>
            </div>
          ) : null}

          {!props.loading && props.error ? (
            <div className="grid size-full place-items-center p-8 text-center" role="alert">
              <div className="max-w-sm">
                <span className="text-[color-mix(in_oklch,oklch(0.62_0.2_25)_50%,var(--text-strong))] mx-auto grid size-12 place-items-center rounded-full bg-[oklch(0.62_0.2_25/0.1)]">
                  <Icon name="warning" className="size-4.5" />
                </span>
                <h3 className="mt-4 text-14-semibold text-text-strong">{language.t("disk.preview.readError")}</h3>
                <p className="mt-2 text-13-regular leading-relaxed text-text-weak">{props.error}</p>
              </div>
            </div>
          ) : null}

          {!props.loading && !props.error && props.node.isDir ? (
            <div className="flex size-full min-h-0 flex-col overflow-auto p-5 sm:p-8">
              <div className="mx-auto w-full max-w-2xl">
                <div className="flex items-start gap-4 rounded-2xl bg-surface-raised-base/70 p-5 shadow-[inset_0_0_0_1px_rgb(127_127_127/0.12)]">
                  <span className="text-[color-mix(in_oklch,var(--dl-accent-strong)_54%,var(--text-strong))] grid size-11 shrink-0 place-items-center rounded-xl bg-background-base/70">
                    <Icon name="folder" className="size-5" />
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-14-semibold text-text-strong">{language.t("disk.preview.folderSummary")}</h3>
                    <p className="mt-1 text-13-regular leading-relaxed text-text-weak">
                      {language.t("disk.preview.folderCount", {
                        count: props.node.children.length.toLocaleString(),
                        items: language.plural("disk.count.itemNoun", props.node.children.length),
                        size: formatBytes(props.node.size),
                      })}
                    </p>
                    <p className="mt-2 text-13-regular leading-relaxed text-text-weaker">
                      {language.t("disk.preview.folderBody")}
                    </p>
                  </div>
                </div>

                {largest.length ? (
                  <section className="mt-6" aria-labelledby="preview-largest-items">
                    <div className="flex items-center justify-between gap-4">
                      <h3
                        id="preview-largest-items"
                        className="text-13-semibold uppercase tracking-[0.13em] text-text-weaker"
                      >
                        {language.t("disk.preview.largest")}
                      </h3>
                      <span className="text-13-regular tabular-nums text-text-weaker">
                        {language.t("disk.preview.total", { count: formatBytes(props.node.size) })}
                      </span>
                    </div>
                    <ul className="mt-2 divide-y divide-border-weaker-base rounded-xl bg-surface-raised-base/45 px-4 shadow-[inset_0_0_0_1px_rgb(127_127_127/0.1)]">
                      {largest.map((child) => (
                        <li key={child.path} className="flex min-w-0 items-center gap-3 py-3">
                          <Icon
                            name={child.isDir ? "folder" : "open-file"}
                            className="size-3.5 shrink-0 text-icon-weak"
                          />
                          <span className="min-w-0 flex-1 truncate text-13-semibold text-text-strong">{child.name}</span>
                          <span className="shrink-0 text-13-semibold tabular-nums text-text-weak">
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

        <footer className="flex shrink-0 flex-wrap items-center gap-3 border-t border-border-weaker-base bg-surface-raised-strong px-4 py-3 sm:px-5">
          <div className="flex shrink-0 items-center gap-1" role="group" aria-label={language.t("disk.preview.navigation")}>
            <Button
              className="min-h-11 min-w-11"
              size="small"
              variant="ghost"
              icon="chevron-left"
              disabled={!props.onPrevious}
              onClick={props.onPrevious}
              aria-label={language.t("disk.preview.previous")}
            />
            <span className="min-w-12 text-center text-13-regular tabular-nums text-text-weaker">
              {!props.node.isDir
                ? language.t("disk.preview.position", { current: props.position, total: props.total })
                : language.t("disk.preview.folder")}
            </span>
            <Button
              className="min-h-11 min-w-11"
              size="small"
              variant="ghost"
              icon="chevron-right"
              disabled={!props.onNext}
              onClick={props.onNext}
              aria-label={language.t("disk.preview.next")}
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-13-semibold tabular-nums text-text-strong">{formatBytes(props.node.size)}</p>
            <p className="mt-0.5 text-13-regular text-text-weaker">
              {props.node.modifiedAt
                ? language.t("disk.preview.changedLocal", { changed: formatLastChanged(props.node.modifiedAt) })
                : language.t("disk.preview.local")}
            </p>
            <StorageAccountingFacts node={props.node} className="mt-1" />
          </div>
          <Button
            className="min-h-11 min-w-11"
            size="small"
            variant="secondary"
            icon="square-arrow-top-right"
            onClick={props.onReveal}
          >
            {props.revealLabel}
          </Button>
          {props.onSystemPreview && props.systemPreviewLabel ? (
            <Button className="min-h-11 min-w-11" size="small" variant="secondary" icon="eye" onClick={props.onSystemPreview}>
              {props.systemPreviewLabel}
            </Button>
          ) : null}
          <Button className="min-h-11 min-w-11" size="small" variant="primary" icon="open-file" onClick={props.onOpen}>
            {language.t(props.node.isDir ? "disk.preview.openMap" : "disk.preview.openDefault")}
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  )
}
