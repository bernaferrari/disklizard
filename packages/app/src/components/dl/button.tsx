import * as React from "react"
import { Button as ShadcnButton } from "@/components/ui/button"
import { Icon } from "./icon"
import type { IconName } from "./icon"

export interface ButtonProps extends Omit<
  React.ComponentProps<typeof ShadcnButton>,
  "size" | "variant"
> {
  size?: "small" | "normal" | "large"
  variant?: "primary" | "secondary" | "ghost"
  icon?: IconName
}

const SIZE_MAP = { small: "sm", normal: "default", large: "lg" } as const
const VARIANT_MAP = {
  primary: "default",
  secondary: "secondary",
  ghost: "ghost",
} as const

/**
 * v1 DiskLizard button surface (variant primary/secondary/ghost, size
 * small/normal/large, optional leading icon) over the shadcn/ui button.
 */
export function Button({
  variant = "secondary",
  size = "normal",
  icon,
  children,
  ...rest
}: ButtonProps) {
  return (
    <ShadcnButton
      variant={VARIANT_MAP[variant]}
      size={SIZE_MAP[size]}
      {...rest}
    >
      {icon ? <Icon name={icon} size="small" /> : null}
      {children}
    </ShadcnButton>
  )
}
