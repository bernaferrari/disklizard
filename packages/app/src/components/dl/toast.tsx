import { toast } from "sonner"
import { Toaster } from "@/components/ui/sonner"

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface ShowToastOptions {
  variant?: "default" | "error" | "success"
  title: string
  description?: string
  duration?: number
  /** Inline action buttons; up to two render (primary + secondary). */
  actions?: ToastAction[]
}

/**
 * v1 `showToast` surface over sonner. Mount `<Toast.Region />` once near the
 * app root.
 */
export function showToast(options: ShowToastOptions) {
  const { variant = "default", title, description, duration, actions } = options
  const [primary, secondary] = actions ?? []
  const actionOptions = {
    description,
    duration,
    ...(primary
      ? { action: { label: primary.label, onClick: primary.onClick } }
      : {}),
    ...(secondary
      ? { cancel: { label: secondary.label, onClick: secondary.onClick } }
      : {}),
  }
  if (variant === "error") {
    toast.error(title, actionOptions)
    return
  }
  if (variant === "success") {
    toast.success(title, actionOptions)
    return
  }
  toast(title, actionOptions)
}

export const Toast = {
  Region: Toaster,
}
