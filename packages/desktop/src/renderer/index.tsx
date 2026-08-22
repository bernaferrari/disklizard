import { Font } from "@opencode-ai/ui/font"
import { I18nProvider, useI18n } from "@opencode-ai/ui/context/i18n"
import { dict as uiEn } from "@opencode-ai/ui/i18n/en"
import { ThemeProvider, useTheme } from "@opencode-ai/ui/theme/context"
import { Toast } from "@opencode-ai/ui/toast"
import { createEffect, createSignal, onCleanup } from "solid-js"
import { render } from "solid-js/web"
import DiskUtilityPage from "../../../app/src/pages/disk-utility"
import { DiskLizardRuntime, type DiskLizardUpdaterState } from "../../../app/src/pages/disk-utility/runtime"
import { handleRendererMenuCommand, rendererMenuHandlers } from "./menu-commands"
import { createDiskLizardPlatform, runRendererMenuAction } from "./platform"
import { resetZoom, zoomIn, zoomOut } from "./webview-zoom"
import "./styles.css"

const root = document.getElementById("root")
if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
  throw new Error("DiskLizard renderer root was not found")
}

const uiI18n = {
  locale: () => "en",
  t: (key: keyof typeof uiEn, params?: Record<string, string | number | boolean>) => {
    const value = uiEn[key] ?? String(key)
    if (!params) return value
    return value.replace(/{{\s*([^}]+?)\s*}}/g, (_, rawKey) => {
      const next = params[String(rawKey)]
      return next === undefined ? "" : String(next)
    })
  },
  plural: (key: Parameters<ReturnType<typeof useI18n>["plural"]>[0], count: number) => String(count) + String(key),
}

function ThemeBridge() {
  const theme = useTheme()
  createEffect(() => {
    theme.themeId()
    theme.mode()
    const bg = getComputedStyle(document.documentElement).getPropertyValue("--background-base").trim()
    if (bg) void window.api.setBackgroundColor(bg)
  })
  return null
}

function DiskLizardApp() {
  const [updaterState, setUpdaterState] = createSignal<DiskLizardUpdaterState>({ status: "disabled" })
  void window.api.updater.subscribe(setUpdaterState)
  const platform = createDiskLizardPlatform(updaterState)

  const onMenu = window.api.onMenuCommand((id) => {
    void handleRendererMenuCommand(
      id,
      rendererMenuHandlers({
        resetZoom,
        zoomIn,
        zoomOut,
        exportLogs: () => window.api.exportDebugLogs(),
        menu: platform.menu,
        runDesktopMenuAction: (action) => runRendererMenuAction(action),
      }),
    )
  })
  onCleanup(onMenu)

  return (
    <ThemeProvider
      onThemeApplied={(_, mode, scheme) => {
        void window.api.setTitlebar?.({ mode, scheme })
      }}
    >
      <I18nProvider value={uiI18n}>
        <Font />
        <Toast.Region />
        <ThemeBridge />
        <DiskLizardRuntime platform={platform}>
          <DiskUtilityPage />
        </DiskLizardRuntime>
      </I18nProvider>
    </ThemeProvider>
  )
}

render(() => <DiskLizardApp />, root!)
