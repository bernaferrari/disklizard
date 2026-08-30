import { oc2Theme } from "@opencode-ai/ui/theme/oc2"
import { resolveThemeVariant, themeToCss } from "@opencode-ai/ui/theme/resolve"
import { resolveThemeVariantV2, themeV2ToCss } from "@opencode-ai/ui/theme/v2/resolve"
import { createEffect, createSignal, onCleanup, type ParentProps } from "solid-js"

const THEME_STYLE_ID = "oc-theme"

function systemMode(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

function ensureThemeStyleElement() {
  const current = document.getElementById(THEME_STYLE_ID)
  if (current instanceof HTMLStyleElement) return current
  const style = document.createElement("style")
  style.id = THEME_STYLE_ID
  document.head.append(style)
  return style
}

export function applyDiskLizardTheme(mode: "light" | "dark") {
  const dark = mode === "dark"
  const variant = dark ? oc2Theme.dark : oc2Theme.light
  const tokens = resolveThemeVariant(variant, dark)
  const v2 = resolveThemeVariantV2(variant, dark)
  ensureThemeStyleElement().textContent = `:root {
  color-scheme: ${mode};
  --text-mix-blend-mode: ${dark ? "plus-lighter" : "multiply"};
  ${themeToCss(tokens)}
  ${themeV2ToCss(v2)}
}`

  const root = document.documentElement
  root.dataset.theme = "oc-2"
  root.dataset.colorScheme = mode
  document.getElementById("oc-theme-preload")?.remove()
  const background = getComputedStyle(root).getPropertyValue("--background-base").trim() || (dark ? "#080808" : "#fafafa")
  root.style.backgroundColor = background
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", background)
  return background
}

export function DiskLizardTheme(
  props: ParentProps<{ onThemeApplied?: (mode: "light" | "dark", background: string) => void }>,
) {
  const media = window.matchMedia("(prefers-color-scheme: dark)")
  const [mode, setMode] = createSignal(systemMode())
  const update = () => setMode(systemMode())
  media.addEventListener("change", update)
  onCleanup(() => media.removeEventListener("change", update))

  createEffect(() => {
    const next = mode()
    props.onThemeApplied?.(next, applyDiskLizardTheme(next))
  })

  return props.children
}
