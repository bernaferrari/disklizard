import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import {
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  OctagonXIcon,
  Loader2Icon,
} from "lucide-react"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      position="bottom-center"
      offset={84}
      gap={8}
      icons={{
        success: <CircleCheckIcon className="size-4 text-[var(--dl-positive)]" />,
        info: <InfoIcon className="size-4 text-[var(--dl-accent)]" />,
        warning: <TriangleAlertIcon className="size-4 text-[var(--dl-warning)]" />,
        error: <OctagonXIcon className="size-4 text-[var(--dl-danger)]" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--dl-popover, var(--popover))",
          "--normal-text": "var(--text-strong, var(--popover-foreground))",
          "--normal-border": "transparent",
          "--border-radius": "14px",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast:
            "cn-toast !gap-3 !px-4 !py-3 !text-[13px] !shadow-[0_0_0_0.5px_rgb(255_255_255/0.1),0_0_0_1px_rgb(0_0_0/0.2),0_16px_44px_rgb(0_0_0/0.35)] !font-[inherit]",
          title: "!font-semibold",
          description: "!text-[12.5px] !leading-relaxed !text-[var(--text-weak)]",
          actionButton:
            "!h-7 !rounded-md !bg-[var(--dl-accent)] !px-3 !text-[12px] !font-semibold !text-white",
          cancelButton:
            "!h-7 !rounded-md !bg-[var(--dl-well-strong)] !px-3 !text-[12px] !text-[var(--text-strong)]",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
