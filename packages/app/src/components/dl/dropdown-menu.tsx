import * as React from "react"
import { Menu } from "@base-ui/react/menu"
import { cn } from "cn"
import {
  DropdownMenu as ShadcnMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export interface DropdownMenuProps extends React.ComponentProps<typeof ShadcnMenu> {
  /** v1 Kobalte placement, e.g. "top-end". */
  placement?: string
  /** v1 Kobalte gutter: pixel offset between trigger and content. */
  gutter?: number
}

type Side = "top" | "bottom" | "left" | "right"
type Align = "start" | "center" | "end"

const PlacementContext = React.createContext<{ side: Side; align: Align; offset: number }>({
  side: "bottom",
  align: "start",
  offset: 4,
})

function parsePlacement(placement: string | undefined): { side: Side; align: Align } {
  if (!placement) return { side: "bottom", align: "start" }
  const [side, align] = placement.split("-") as [Side, Align | undefined]
  return { side, align: align ?? "center" }
}

function DropdownMenuRoot({ placement, gutter, children, ...rest }: DropdownMenuProps) {
  const { side, align } = parsePlacement(placement)
  const value = React.useMemo(() => ({ side, align, offset: gutter ?? 4 }), [side, align, gutter])
  return (
    <PlacementContext.Provider value={value}>
      <ShadcnMenu {...rest}>{children}</ShadcnMenu>
    </PlacementContext.Provider>
  )
}

function DropdownMenuContentCompat({ children, ...rest }: React.ComponentProps<"div">) {
  const { side, align, offset } = React.useContext(PlacementContext)
  return (
    <DropdownMenuContent side={side} align={align} sideOffset={offset} {...rest}>
      {children}
    </DropdownMenuContent>
  )
}

function DropdownMenuTriggerCompat<As extends React.ElementType = "button">({
  as,
  children,
  ...rest
}: React.ComponentProps<typeof DropdownMenuTrigger> & { as?: As } & React.ComponentProps<As>) {
  if (as) {
    const Component = as
    return <DropdownMenuTrigger render={<Component {...rest}>{children}</Component>} />
  }
  return <DropdownMenuTrigger {...rest}>{children}</DropdownMenuTrigger>
}

/**
 * v1-compatible compound DropdownMenu: subcomponent names match the Kobalte
 * surface the disk-utility UI was written against. `Item.onSelect` and
 * `RadioGroup.onChange` map onto base-ui's onClick/onValueChange.
 */
export const DropdownMenu = Object.assign(DropdownMenuRoot, {
  Trigger: DropdownMenuTriggerCompat,
  Portal: DropdownMenuPortal,
  Content: DropdownMenuContentCompat,
  Group: DropdownMenuGroup,
  GroupLabel: function GroupLabel({ className, ...rest }: React.ComponentProps<"div">) {
    return <DropdownMenuGroupLabel className={cn("px-1.5 py-1 text-xs text-muted-foreground", className)} {...rest} />
  },
  Item: function Item({ onSelect, ...rest }: React.ComponentProps<typeof Menu.Item> & { onSelect?: () => void }) {
    return <Menu.Item className="dl-menu-item" onClick={onSelect} {...rest} />
  },
  ItemLabel: function ItemLabel({ className, ...rest }: React.ComponentProps<"span">) {
    return <span className={cn("flex-1", className)} {...rest} />
  },
  ItemIndicator: function ItemIndicator({ children }: { children?: React.ReactNode }) {
    return <Menu.RadioItemIndicator className="flex size-4 shrink-0 items-center justify-center">{children}</Menu.RadioItemIndicator>
  },
  Separator: DropdownMenuSeparator,
  RadioGroup: function RadioGroup({
    value,
    onChange,
    ...rest
  }: React.ComponentProps<typeof Menu.RadioGroup> & { onChange?: (value: string) => void }) {
    return <Menu.RadioGroup value={value} onValueChange={onChange} {...rest} />
  },
  RadioItem: function RadioItem({ className, ...rest }: React.ComponentProps<typeof Menu.RadioItem>) {
    return (
      <Menu.RadioItem
        className={cn(
          "dl-menu-item relative flex cursor-default items-center gap-1.5 rounded-md py-1 pr-2 pl-1.5 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
          className,
        )}
        {...rest}
      />
    )
  },
})

function DropdownMenuGroupLabel({ className, ...rest }: React.ComponentProps<"div">) {
  return <Menu.GroupLabel className={cn("dl-menu-group-label", className)} {...rest} />
}
