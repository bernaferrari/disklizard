import * as React from "react"

export type ScrollViewThumbVisibility = "hover" | "scroll"

export interface ScrollViewProps extends React.ComponentProps<"div"> {
  /** Called with the scrolling viewport element (the root div). */
  viewportRef?: (element: HTMLDivElement) => void
  orientation?: "vertical" | "horizontal"
  thumbVisibility?: ScrollViewThumbVisibility
}

/** Keys the v1 ScrollView handled for scrolling semantics; kept for callers. */
export const scrollKey = (
  event: Pick<KeyboardEvent, "key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey">,
): "page-down" | "page-up" | "home" | "end" | "up" | "down" | "left" | "right" | "space" | undefined => {
  if (event.altKey || event.ctrlKey || event.metaKey) return
  if (event.shiftKey && event.key !== " ") return

  switch (event.key) {
    case "PageDown":
      return "page-down"
    case "PageUp":
      return "page-up"
    case "Home":
      return "home"
    case "End":
      return "end"
    case "ArrowUp":
      return "up"
    case "ArrowDown":
      return "down"
    case "ArrowLeft":
      return "left"
    case "ArrowRight":
      return "right"
    case " ":
      return "space"
  }
}

/**
 * Scrolling container with DiskLizard's thin token-driven scrollbars.
 * The element itself is the scroll viewport; `viewportRef` hands it to
 * consumers such as the virtualized storage list.
 */
export function ScrollView({ viewportRef, className, children, ...rest }: ScrollViewProps) {
  const ref = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    const element = ref.current
    if (element && viewportRef) viewportRef(element)
    return () => {
      if (element && viewportRef) viewportRef(null as unknown as HTMLDivElement)
    }
  }, [viewportRef])

  return (
    <div
      ref={ref}
      data-component="scroll-view"
      className={className}
      style={{ overflow: "auto", minHeight: 0 }}
      {...rest}
    >
      {children}
    </div>
  )
}
