import { ChevronLeft, ChevronRight } from "lucide-react"
import { useLayoutEffect, useRef } from "react"
import { useLanguage } from "./runtime"

type Location = { name: string; key: string }
export function LocationNavigation(props: {
  locations: Location[]
  canBack: boolean
  canForward: boolean
  onBack: () => void
  onForward: () => void
  onHome: () => void
  onLocation: (index: number) => void
}) {
  const language = useLanguage()
  const trail = useRef<HTMLElement>(null)
  const current = props.locations.at(-1)?.key
  useLayoutEffect(() => {
    if (trail.current) trail.current.scrollLeft = trail.current.scrollWidth
  }, [current])
  const historyButton =
    "grid size-8 place-items-center rounded-md text-text-weak hover:bg-surface-raised-strong hover:text-text-strong disabled:opacity-30 disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-text-strong"
  return (
    <>
      <div className="dl-history-controls flex shrink-0 items-center gap-0.5 rounded-lg border border-border-weaker-base/60 bg-surface-raised-base/60 p-0.5">
        <button
          type="button"
          data-disk-history-back
          className={historyButton}
          aria-label={language.t("disk.top.previousLocation")}
          disabled={!props.canBack}
          onClick={props.onBack}
        >
          <ChevronLeft aria-hidden className="size-4" />
        </button>
        <button
          type="button"
          data-disk-history-forward
          className={historyButton}
          aria-label={language.t("disk.top.nextLocation")}
          disabled={!props.canForward}
          onClick={props.onForward}
        >
          <ChevronRight aria-hidden className="size-4" />
        </button>
      </div>
      <button
        type="button"
        data-disk-navigation-home
        onClick={props.onHome}
        className="h-8 shrink-0 rounded-md px-2.5 text-xs text-text-weak hover:bg-surface-raised-base hover:text-text-strong focus-visible:outline-2 focus-visible:outline-text-strong"
      >
        {language.t("disk.common.volumes")}
      </button>
      <span aria-hidden className="h-4 w-px shrink-0 bg-border-weaker-base" />
      <nav
        ref={trail}
        aria-label={language.t("disk.top.currentLocation")}
        className="dl-breadcrumbs flex min-w-0 flex-1 [scrollbar-width:none] items-center overflow-x-auto [&::-webkit-scrollbar]:hidden"
      >
        {props.locations.map((location, index) => (
          <div key={location.key} className="flex shrink-0 items-center">
            {index > 0 && (
              <ChevronRight
                aria-hidden
                className="mx-0.5 size-3 text-text-weaker"
              />
            )}
            <button
              type="button"
              onClick={() => props.onLocation(index)}
              title={location.name}
              aria-current={
                index === props.locations.length - 1 ? "page" : undefined
              }
              className="h-8 max-w-[160px] truncate rounded-md px-2.5 text-xs text-text-weak hover:bg-surface-raised-base hover:text-text-strong focus-visible:outline-2 focus-visible:outline-text-strong aria-[current=page]:bg-surface-raised-strong aria-[current=page]:font-medium aria-[current=page]:text-text-strong"
            >
              {location.name}
            </button>
          </div>
        ))}
      </nav>
    </>
  )
}
