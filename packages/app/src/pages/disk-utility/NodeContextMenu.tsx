import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { motion } from "framer-motion"
import { cn } from "@/lib/utils"

export type ContextMenuItem =
  | {
      kind?: "item"
      label: string
      icon?: ReactNode
      shortcut?: string
      danger?: boolean
      disabled?: boolean
      onSelect: () => void
    }
  | { kind: "separator" }

/**
 * One right-click menu for every surface (map, tiles, layers, list). It is
 * positioned at the pointer, clamped to the window, keyboard navigable, and
 * dismissed by Escape, scrolling, resizing, or a click elsewhere.
 */
export function NodeContextMenu(props: {
  at: { x: number; y: number } | null
  title?: string
  items: readonly ContextMenuItem[]
  onClose: () => void
}) {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null)

  useLayoutEffect(() => {
    if (!props.at || !menuRef.current) {
      setPosition(null)
      return
    }
    const rect = menuRef.current.getBoundingClientRect()
    setPosition({
      x: Math.max(8, Math.min(props.at.x, window.innerWidth - rect.width - 8)),
      y: Math.max(8, Math.min(props.at.y, window.innerHeight - rect.height - 8)),
    })
    menuRef.current
      .querySelector<HTMLElement>("[role=menuitem]:not([aria-disabled=true])")
      ?.focus({ preventScroll: true })
  }, [props.at])

  useEffect(() => {
    if (!props.at) return undefined
    const close = () => props.onClose()
    const onPointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) close()
    }
    window.addEventListener("pointerdown", onPointer, true)
    window.addEventListener("resize", close)
    window.addEventListener("blur", close)
    document.addEventListener("scroll", close, true)
    return () => {
      window.removeEventListener("pointerdown", onPointer, true)
      window.removeEventListener("resize", close)
      window.removeEventListener("blur", close)
      document.removeEventListener("scroll", close, true)
    }
  }, [props.at, props.onClose])

  if (!props.at) return null
  const focusable = () =>
    [...(menuRef.current?.querySelectorAll<HTMLElement>("[role=menuitem]:not([aria-disabled=true])") ?? [])]

  return (
    <motion.div
      ref={menuRef}
      role="menu"
      aria-label={props.title}
      className="fixed z-[90] min-w-[220px] rounded-xl bg-[var(--dl-popover)] p-1 text-[13px] text-text-strong shadow-[0_0_0_0.5px_rgb(255_255_255/0.1),0_0_0_1px_rgb(0_0_0/0.25),0_14px_40px_rgb(0_0_0/0.35)] outline-none"
      style={{
        left: position?.x ?? props.at.x,
        top: position?.y ?? props.at.y,
        visibility: position ? "visible" : "hidden",
      }}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.12, ease: [0.22, 1, 0.36, 1] }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        const items = focusable()
        const index = items.indexOf(document.activeElement as HTMLElement)
        if (event.key === "Escape") {
          event.preventDefault()
          event.stopPropagation()
          props.onClose()
        } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault()
          event.stopPropagation()
          const next =
            (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length
          items[next]?.focus()
        } else if (event.key === "Tab") {
          event.preventDefault()
        }
      }}
    >
      {props.title ? (
        <p className="truncate px-2.5 pt-1.5 pb-1 text-[11.5px] font-medium text-text-weak">
          {props.title}
        </p>
      ) : null}
      {props.items.map((item, index) =>
        item.kind === "separator" ? (
          <div key={`separator-${index}`} className="mx-2 my-1 h-px bg-[var(--dl-separator)]" />
        ) : (
          <div
            key={item.label}
            role="menuitem"
            tabIndex={-1}
            aria-disabled={item.disabled || undefined}
            className={cn(
              "flex h-8 cursor-default items-center gap-2.5 rounded-md px-2.5 outline-none select-none",
              item.disabled
                ? "opacity-40"
                : item.danger
                  ? "text-[var(--dl-danger)] focus:bg-[var(--dl-danger)] focus:text-white hover:bg-[var(--dl-danger)] hover:text-white"
                  : "focus:bg-[var(--dl-accent)] focus:text-white hover:bg-[var(--dl-accent)] hover:text-white"
            )}
            onMouseEnter={(event) => {
              if (!item.disabled) event.currentTarget.focus()
            }}
            onClick={() => {
              if (item.disabled) return
              props.onClose()
              item.onSelect()
            }}
            onKeyDown={(event) => {
              if ((event.key === "Enter" || event.key === " ") && !item.disabled) {
                event.preventDefault()
                event.stopPropagation()
                props.onClose()
                item.onSelect()
              }
            }}
          >
            <span className="grid size-4 shrink-0 place-items-center opacity-80 [&_svg]:size-[15px]">
              {item.icon}
            </span>
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {item.shortcut ? (
              <span className="shrink-0 text-[11.5px] opacity-55">{item.shortcut}</span>
            ) : null}
          </div>
        )
      )}
    </motion.div>
  )
}
