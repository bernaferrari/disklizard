import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { For, Show, onCleanup, onMount } from "solid-js"
import type { DiskFilePreview, DiskScanNode } from "./types"
import { formatBytes, formatLastChanged } from "./format"
import type { SurfacePhase } from "./motion"
import { StorageAccountingFacts } from "./StorageAccounting"
import { diskLanguageText, useLanguage } from "./runtime"

const focusable =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), iframe:not([tabindex="-1"]), [tabindex]:not([tabindex="-1"])'

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
  phase: SurfacePhase
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
  systemPreviewLabel?: string
  onSystemPreview?: () => void
  onOpen: () => void
}) {
  const language = useLanguage()
  let panel!: HTMLDivElement
  let restoreFocus: HTMLElement | undefined
  const largestChildren = () =>
    [...props.node.children]
      .filter((child) => !child.isOther)
      .toSorted((a, b) => b.size - a.size)
      .slice(0, 5)

  onMount(() => {
    const active = document.activeElement
    restoreFocus = active instanceof HTMLElement ? active : undefined
    queueMicrotask(() => panel.focus({ preventScroll: true }))
  })
  onCleanup(() => restoreFocus?.isConnected && restoreFocus.focus({ preventScroll: true }))

  const trapFocus = (event: KeyboardEvent) => {
    if (event.target === panel && event.key === "ArrowLeft" && props.onPrevious) {
      event.preventDefault()
      props.onPrevious()
      return
    }
    if (event.target === panel && event.key === "ArrowRight" && props.onNext) {
      event.preventDefault()
      props.onNext()
      return
    }
    if (event.key !== "Tab") return
    const items = [...panel.querySelectorAll<HTMLElement>(focusable)]
    if (!items.length) {
      event.preventDefault()
      panel.focus()
      return
    }
    const first = items[0]
    const last = items.at(-1)!
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div
      class="dl-dialog-surface fixed inset-0 z-50 grid place-items-center bg-background-base/68 p-3 backdrop-blur-md sm:p-6"
      data-state={props.phase}
      onClick={props.onClose}
      role="presentation"
    >
      <div
        ref={panel}
        class="dl-dialog-panel flex h-[min(760px,calc(100dvh-24px))] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-surface-raised-strong shadow-[0_0_0_1px_rgb(127_127_127/0.13),0_28px_90px_rgb(0_0_0/0.28)] sm:h-[min(760px,calc(100dvh-48px))]"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={trapFocus}
        role="dialog"
        aria-modal="true"
        aria-labelledby="preview-title"
        aria-describedby="preview-description"
      >
        <header class="flex shrink-0 items-start gap-3 border-b border-border-weaker-base px-4 py-3.5 sm:px-5">
          <span class="dl-accent-text grid size-10 shrink-0 place-items-center rounded-xl bg-[oklch(0.72_0.12_176/0.14)]">
            <Icon
              name={props.node.isDir ? "folder" : props.preview?.kind === "image" ? "photo" : "open-file"}
              class="size-4"
            />
          </span>
          <div class="min-w-0 flex-1">
            <p class="text-13-semibold uppercase tracking-[0.14em] text-text-weaker">
              {language.t("disk.preview.heading")}
            </p>
            <h2 id="preview-title" class="mt-0.5 truncate text-16-semibold tracking-[-0.02em] text-text-strong">
              {props.node.name}
            </h2>
            <p id="preview-description" class="mt-0.5 truncate text-13-mono text-text-weaker">
              {props.node.path}
            </p>
          </div>
          <Button
            class="dl-touch-target"
            size="small"
            variant="ghost"
            icon="close"
            onClick={props.onClose}
            aria-label={language.t("disk.preview.close")}
          />
        </header>

        <main class="relative min-h-0 flex-1 overflow-hidden bg-background-base/55">
          <Show when={props.loading}>
            <div class="grid size-full place-items-center" role="status" aria-live="polite">
              <div class="flex flex-col items-center gap-3 text-text-weak">
                <span class="dl-spin size-5 rounded-full border border-border-weaker-base border-t-current" />
                <p class="text-13-regular">{language.t("disk.preview.loading")}</p>
              </div>
            </div>
          </Show>

          <Show when={!props.loading && props.error}>
            {(message) => (
              <div class="grid size-full place-items-center p-8 text-center" role="alert">
                <div class="max-w-sm">
                  <span class="dl-critical-text mx-auto grid size-12 place-items-center rounded-full bg-[oklch(0.62_0.2_25/0.1)]">
                    <Icon name="warning" class="size-4.5" />
                  </span>
                  <h3 class="mt-4 text-14-semibold text-text-strong">{language.t("disk.preview.readError")}</h3>
                  <p class="mt-2 text-13-regular leading-relaxed text-text-weak">{message()}</p>
                </div>
              </div>
            )}
          </Show>

          <Show when={!props.loading && !props.error && props.node.isDir}>
            <div class="flex size-full min-h-0 flex-col overflow-auto p-5 sm:p-8">
              <div class="mx-auto w-full max-w-2xl">
                <div class="flex items-start gap-4 rounded-2xl bg-surface-raised-base/70 p-5 shadow-[inset_0_0_0_1px_rgb(127_127_127/0.12)]">
                  <span class="dl-accent-text grid size-11 shrink-0 place-items-center rounded-xl bg-background-base/70">
                    <Icon name="folder" class="size-5" />
                  </span>
                  <div class="min-w-0">
                    <h3 class="text-14-semibold text-text-strong">{language.t("disk.preview.folderSummary")}</h3>
                    <p class="mt-1 text-13-regular leading-relaxed text-text-weak">
                      {language.t("disk.preview.folderCount", {
                        count: props.node.children.length.toLocaleString(),
                        items: language.plural("disk.count.itemNoun", props.node.children.length),
                        size: formatBytes(props.node.size),
                      })}
                    </p>
                    <p class="mt-2 text-13-regular leading-relaxed text-text-weaker">
                      {language.t("disk.preview.folderBody")}
                    </p>
                  </div>
                </div>

                <Show when={largestChildren().length}>
                  <section class="mt-6" aria-labelledby="preview-largest-items">
                    <div class="flex items-center justify-between gap-4">
                      <h3 id="preview-largest-items" class="text-13-semibold uppercase tracking-[0.13em] text-text-weaker">
                        {language.t("disk.preview.largest")}
                      </h3>
                      <span class="text-13-regular tabular-nums text-text-weaker">
                        {language.t("disk.preview.total", { count: formatBytes(props.node.size) })}
                      </span>
                    </div>
                    <ul class="mt-2 divide-y divide-border-weaker-base rounded-xl bg-surface-raised-base/45 px-4 shadow-[inset_0_0_0_1px_rgb(127_127_127/0.1)]">
                      <For each={largestChildren()}>
                        {(child) => (
                          <li class="flex min-w-0 items-center gap-3 py-3">
                            <Icon name={child.isDir ? "folder" : "open-file"} class="size-3.5 shrink-0 text-icon-weak" />
                            <span class="min-w-0 flex-1 truncate text-13-semibold text-text-strong">{child.name}</span>
                            <span class="shrink-0 text-13-semibold tabular-nums text-text-weak">{formatBytes(child.size)}</span>
                          </li>
                        )}
                      </For>
                    </ul>
                  </section>
                </Show>
              </div>
            </div>
          </Show>

          <Show when={!props.loading && !props.error && !props.node.isDir && props.preview}>
            {(loaded) => {
              const preview = loaded()
              if (preview.kind === "image") {
                return (
                  <div class="dl-preview-image-stage grid size-full place-items-center overflow-auto p-5 sm:p-8">
                    <img
                      class="max-h-full max-w-full rounded-xl object-contain shadow-[0_0_0_1px_rgb(127_127_127/0.16),0_18px_50px_rgb(0_0_0/0.18)]"
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
                  <div class="flex size-full min-h-0 flex-col">
                    <div class="flex shrink-0 items-center justify-between border-b border-border-weaker-base px-4 py-2 text-13-regular text-text-weaker">
                      <span>
                        {language.t("disk.preview.lines", { count: preview.text.split("\n").length.toLocaleString() })}
                      </span>
                      <Show when={preview.truncated}>
                        <span class="rounded-full bg-surface-raised-base px-2 py-1 text-13-semibold text-text-weak">
                          {language.t("disk.preview.truncated")}
                        </span>
                      </Show>
                    </div>
                    <pre
                      class="min-h-0 flex-1 overflow-auto p-4 font-mono text-[12px] leading-[1.65] text-text-base outline-none selection:bg-[oklch(0.72_0.12_176/0.24)] sm:p-5"
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
                    class="size-full border-0 bg-surface-raised-strong outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-text-weak"
                    src={preview.dataUrl}
                    title={language.t("disk.preview.pdfLabel", { name: props.node.name })}
                    tabIndex={0}
                  />
                )
              }
              const copy = unsupportedCopy(preview)
              return (
                <div class="grid size-full place-items-center p-8 text-center">
                  <div class="max-w-sm">
                    <span class="mx-auto grid size-12 place-items-center rounded-full bg-surface-raised-base text-text-weak">
                      <Icon name="open-file" class="size-4.5" />
                    </span>
                    <h3 class="mt-4 text-14-semibold text-text-strong">{copy.title}</h3>
                    <p class="mt-2 text-13-regular leading-relaxed text-text-weak">{copy.detail}</p>
                  </div>
                </div>
              )
            }}
          </Show>
        </main>

        <footer class="flex shrink-0 flex-wrap items-center gap-3 border-t border-border-weaker-base bg-surface-raised-strong px-4 py-3 sm:px-5">
          <div
            class="flex shrink-0 items-center gap-1"
            role="group"
            aria-label={language.t("disk.preview.navigation")}
          >
            <Button
              class="dl-touch-target"
              size="small"
              variant="ghost"
              icon="chevron-left"
              disabled={!props.onPrevious}
              onClick={props.onPrevious}
              aria-label={language.t("disk.preview.previous")}
            />
            <span class="min-w-12 text-center text-13-regular tabular-nums text-text-weaker">
              <Show when={!props.node.isDir} fallback={language.t("disk.preview.folder")}>
                {language.t("disk.preview.position", { current: props.position, total: props.total })}
              </Show>
            </span>
            <Button
              class="dl-touch-target"
              size="small"
              variant="ghost"
              icon="chevron-right"
              disabled={!props.onNext}
              onClick={props.onNext}
              aria-label={language.t("disk.preview.next")}
            />
          </div>
          <div class="min-w-0 flex-1">
            <p class="text-13-semibold tabular-nums text-text-strong">
              {formatBytes(props.preview?.bytes ?? props.node.size)}
            </p>
            <p class="mt-0.5 text-13-regular text-text-weaker">
              <Show when={props.node.modifiedAt} fallback={language.t("disk.preview.local")}>
                {(changed) =>
                  language.t("disk.preview.changedLocal", { changed: formatLastChanged(changed()) })
                }
              </Show>
            </p>
            <StorageAccountingFacts node={props.node} class="mt-1" />
          </div>
          <Button
            class="dl-touch-target"
            size="small"
            variant="secondary"
            icon="square-arrow-top-right"
            onClick={props.onReveal}
          >
            {language.t("disk.common.reveal")}
          </Button>
          <Show when={props.onSystemPreview && props.systemPreviewLabel}>
            <Button
              class="dl-touch-target"
              size="small"
              variant="secondary"
              icon="eye"
              onClick={props.onSystemPreview}
            >
              {props.systemPreviewLabel}
            </Button>
          </Show>
          <Button class="dl-touch-target" size="small" variant="primary" icon="open-file" onClick={props.onOpen}>
            {language.t("disk.preview.openDefault")}
          </Button>
        </footer>
      </div>
    </div>
  )
}
