import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { createVirtualizer } from "@tanstack/solid-virtual"
import { createEffect, createSignal, For, onCleanup, Show, type JSX } from "solid-js"
import type { DiskScanNode } from "./types"
import { isReviewNavigationKey, reviewNavigationTarget } from "./review-navigation"
import { useLanguage } from "./runtime"

const INDEX_ROW_ESTIMATE = 58
const DEFAULT_LIST_PAGE_SIZE = 10

type IndexEntry = { node: DiskScanNode; colorIndex: number; displaySize: number }

export function VirtualIndex(props: {
  entries: IndexEntry[]
  bindScrollToIndex: (fn: ((index: number) => void) | undefined) => void
  bindPageSize: (fn: (() => number) | undefined) => void
  onMoveFocus: (delta: number, extendRange?: boolean) => number
  onPageFocus: (direction: -1 | 1, pageSize: number, extendRange?: boolean) => number
  onMoveFocusToBoundary: (boundary: "first" | "last", extendRange?: boolean) => number
  render: (entry: IndexEntry, index: () => number) => JSX.Element
}) {
  const language = useLanguage()
  const [viewport, setViewport] = createSignal<HTMLDivElement>()
  const virtualizer = createVirtualizer<HTMLDivElement, HTMLLIElement>({
    get count() {
      return props.entries.length
    },
    getScrollElement: () => viewport() ?? null,
    estimateSize: () => INDEX_ROW_ESTIMATE,
    overscan: 10,
    getItemKey: (index) => props.entries[index]?.node.path ?? index,
  })
  const scrollToIndex = (index: number) => virtualizer.scrollToIndex(index, { align: "auto" })
  const pageSize = () =>
    Math.max(
      1,
      Math.floor((viewport()?.clientHeight ?? INDEX_ROW_ESTIMATE * DEFAULT_LIST_PAGE_SIZE) / INDEX_ROW_ESTIMATE),
    )
  props.bindScrollToIndex(scrollToIndex)
  props.bindPageSize(pageSize)
  onCleanup(() => {
    props.bindScrollToIndex(undefined)
    props.bindPageSize(undefined)
  })

  return (
    <ScrollView
      class="min-h-0 flex-1"
      viewportRef={setViewport}
      onKeyDown={(event) => {
        if (event.defaultPrevented) return
        const supportsRangeNavigation = !event.metaKey && !event.ctrlKey && !event.altKey
        const isPlainShortcut = supportsRangeNavigation && !event.shiftKey
        if (
          supportsRangeNavigation &&
          (event.key === "ArrowDown" ||
            event.key === "ArrowUp" ||
            (isPlainShortcut && (event.key === "j" || event.key === "k")))
        ) {
          event.preventDefault()
          event.stopPropagation()
          props.onMoveFocus(event.key === "ArrowDown" || event.key === "j" ? 1 : -1, event.shiftKey)
          return
        }
        if (supportsRangeNavigation && (event.key === "PageDown" || event.key === "PageUp")) {
          event.preventDefault()
          event.stopPropagation()
          props.onPageFocus(event.key === "PageDown" ? 1 : -1, pageSize(), event.shiftKey)
          return
        }
        if (supportsRangeNavigation && (event.key === "Home" || event.key === "End")) {
          event.preventDefault()
          event.stopPropagation()
          props.onMoveFocusToBoundary(event.key === "Home" ? "first" : "last", event.shiftKey)
        }
      }}
    >
      <ul
        id="disklizard-storage-list"
        class="relative mx-2 my-2"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
        aria-label={language.t("disk.virtual.entries")}
      >
        <For each={virtualizer.getVirtualItems()}>
          {(item) => {
            const entry = () => props.entries[item.index]
            return (
              <Show when={entry()}>
                {(value) => (
                  <li
                    class="absolute left-0 top-0 w-full"
                    style={{ height: `${item.size}px`, transform: `translateY(${item.start}px)` }}
                  >
                    {props.render(value(), () => item.index)}
                  </li>
                )}
              </Show>
            )
          }}
        </For>
      </ul>
    </ScrollView>
  )
}

export function VirtualRows<T>(props: {
  items: T[]
  ariaLabel: string
  estimateSize: (item: T) => number
  itemKey: (item: T, index: number) => string | number
  isFocusable?: (item: T, index: number) => boolean
  render: (item: T, index: () => number) => JSX.Element
}) {
  const [viewport, setViewport] = createSignal<HTMLDivElement>()
  const [activeIndex, setActiveIndex] = createSignal(-1)
  let list: HTMLUListElement | undefined
  const padding = 8
  const virtualizer = createVirtualizer<HTMLDivElement, HTMLLIElement>({
    get count() {
      return props.items.length
    },
    getScrollElement: () => viewport() ?? null,
    estimateSize: (index) => props.estimateSize(props.items[index]),
    overscan: 8,
    getItemKey: (index) => props.itemKey(props.items[index], index),
  })

  const isFocusable = (index: number) => {
    const item = props.items[index]
    return item !== undefined && (props.isFocusable?.(item, index) ?? true)
  }
  const firstFocusable = () =>
    reviewNavigationTarget({
      currentIndex: -1,
      key: "ArrowDown",
      length: props.items.length,
      pageSize: 1,
      isFocusable,
    })
  const pageSize = () => {
    const item = props.items[activeIndex()] ?? props.items[firstFocusable()]
    const estimate = item ? props.estimateSize(item) : INDEX_ROW_ESTIMATE
    return Math.max(1, Math.floor((viewport()?.clientHeight ?? estimate * DEFAULT_LIST_PAGE_SIZE) / estimate))
  }
  const focusRow = (index: number, attempt = 0) => {
    setActiveIndex(index)
    virtualizer.scrollToIndex(index, { align: "auto" })
    requestAnimationFrame(() => {
      const row = list?.querySelector<HTMLElement>(`[data-disk-review-index="${index}"]`)
      if (row) {
        row.focus({ preventScroll: true })
        return
      }
      if (attempt < 2) focusRow(index, attempt + 1)
    })
  }
  const onReviewNavigation = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || !isReviewNavigationKey(event.key)) {
      return
    }
    const target = reviewNavigationTarget({
      currentIndex: activeIndex(),
      key: event.key,
      length: props.items.length,
      pageSize: pageSize(),
      isFocusable,
    })
    if (target < 0) return
    event.preventDefault()
    event.stopImmediatePropagation()
    focusRow(target)
  }
  let removeViewportKeydown: (() => void) | undefined
  const bindViewport = (element: HTMLDivElement) => {
    removeViewportKeydown?.()
    setViewport(element)
    element.addEventListener("keydown", onReviewNavigation, true)
    removeViewportKeydown = () => element.removeEventListener("keydown", onReviewNavigation, true)
  }
  onCleanup(() => removeViewportKeydown?.())

  createEffect(() => {
    const current = activeIndex()
    if (current < 0 || !isFocusable(current)) setActiveIndex(firstFocusable())
  })

  return (
    <ScrollView class="min-h-0 flex-1" viewportRef={bindViewport}>
      <ul
        ref={(element) => {
          list = element
        }}
        class="relative"
        style={{ height: `${virtualizer.getTotalSize() + padding * 2}px` }}
        aria-label={props.ariaLabel}
      >
        <For each={virtualizer.getVirtualItems()}>
          {(row) => {
            const item = () => props.items[row.index]
            return (
              <Show when={item()}>
                {(value) => (
                  <li
                    class="absolute left-0 top-0 w-full outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-text-weak"
                    style={{ height: `${row.size}px`, transform: `translateY(${row.start + padding}px)` }}
                    data-disk-review-index={row.index}
                    tabIndex={isFocusable(row.index) ? (row.index === activeIndex() ? 0 : -1) : undefined}
                    aria-posinset={row.index + 1}
                    aria-setsize={props.items.length}
                    onFocusIn={() => {
                      if (isFocusable(row.index)) setActiveIndex(row.index)
                    }}
                  >
                    {props.render(value(), () => row.index)}
                  </li>
                )}
              </Show>
            )
          }}
        </For>
      </ul>
    </ScrollView>
  )
}
