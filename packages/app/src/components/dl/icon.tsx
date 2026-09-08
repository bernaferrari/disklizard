import * as React from "react"
import { icons, type IconName } from "./icon-paths"

function viewBox(name: IconName) {
  return name === "magnifying-glass" || name === "arrow-undo-down" || name === "subagent" ? "0 0 16 16" : "0 0 20 20"
}

export interface IconProps extends React.ComponentProps<"svg"> {
  name: IconName
  size?: "small" | "normal" | "medium" | "large"
}

export function Icon({ name, size, className, ...others }: IconProps) {
  return (
    <div
      data-component="icon"
      data-size={size || "normal"}
      data-directional={
        name === "arrow-left" || name === "arrow-right" || name === "chevron-left" || name === "chevron-right"
          ? true
          : undefined
      }
    >
      <svg
        data-slot="icon-svg"
        className={className}
        fill="none"
        viewBox={viewBox(name)}
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: icons[name] ?? "" }}
        {...others}
      />
    </div>
  )
}

export type { IconName }
