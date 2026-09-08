import * as React from "react"
import { Popover as PopoverPrimitive } from "@base-ui/react/popover"
import { cn } from "cn"

export interface PopoverProps {
  /** Element rendered as the trigger. */
  trigger?: React.ReactNode
  /** Tag or component used to render the trigger. */
  triggerAs?: React.ElementType
  /** Props forwarded onto the trigger element. */
  triggerProps?: Record<string, unknown>
  title?: React.ReactNode
  description?: React.ReactNode
  /** v1 Kobalte placement, e.g. "bottom-start". */
  placement?: string
  /** Render inline instead of into a portal. */
  portal?: boolean
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  className?: string
  style?: React.CSSProperties
  children?: React.ReactNode
}

type Side = "top" | "bottom" | "left" | "right"
type Align = "start" | "center" | "end"

function parsePlacement(placement: string | undefined): { side: Side; align: Align } {
  if (!placement) return { side: "bottom", align: "center" }
  const [side, align] = placement.split("-") as [Side, Align | undefined]
  return { side, align: align ?? "center" }
}

/**
 * v1 DiskLizard Popover surface: declarative trigger + title/description
 * header, positioned popup — styled like the shadcn/ui popover, built
 * directly on Base UI so `portal={false}` can render inline.
 */
export function Popover({
  trigger,
  triggerAs,
  triggerProps,
  title,
  description,
  placement,
  portal = true,
  className,
  style,
  children,
  ...rest
}: PopoverProps) {
  const inlineContainer = React.useRef<HTMLDivElement>(null)
  const { side, align } = parsePlacement(placement)
  const As = triggerAs ?? "button"
  const header = title || description
  const positioner = (
    <PopoverPrimitive.Positioner className="isolate z-50" side={side} align={align} sideOffset={6}>
      <PopoverPrimitive.Popup
        data-slot="popover-content"
        className={cn(
          "z-50 flex w-72 max-w-(--available-width) origin-(--transform-origin) flex-col gap-2.5 rounded-lg bg-popover p-2.5 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className,
        )}
        style={style}
      >
        {header ? (
          <div className="flex flex-col gap-0.5">
            {title ? <PopoverPrimitive.Title className="font-medium">{title}</PopoverPrimitive.Title> : null}
            {description ? (
              <PopoverPrimitive.Description className="text-muted-foreground">{description}</PopoverPrimitive.Description>
            ) : null}
          </div>
        ) : null}
        {children}
      </PopoverPrimitive.Popup>
    </PopoverPrimitive.Positioner>
  )
  return (
    <PopoverPrimitive.Root {...rest}>
      <PopoverPrimitive.Trigger render={React.createElement(As, { ...(triggerProps ?? {}) }, trigger)} />
      {!portal && <div ref={inlineContainer} className="contents" />}
      <PopoverPrimitive.Portal container={portal ? undefined : inlineContainer}>
        {positioner}
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}
