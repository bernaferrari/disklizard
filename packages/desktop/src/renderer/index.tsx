import "@vitejs/plugin-react/preamble"
import { useEffect, useMemo, useState } from "react"
import { createRoot } from "react-dom/client"
import {
  configureDiskLanguage, DiskUtilityPage, DiskLizardRuntime, DiskMotionProvider,
  ThemeProvider, useTheme, Toast, type DiskLizardUpdaterState,
} from "@disklizard/app"
import { createDesktopNativeBundle, DESKTOP_NATIVE_ENGLISH } from "@disklizard/app/native-i18n"
import { loadRendererLanguage } from "./i18n"
import { handleRendererMenuCommand, rendererMenuHandlers } from "./menu-commands"
import { createDiskLizardPlatform, runRendererMenuAction } from "./platform"
import { resetZoom, zoomIn, zoomOut } from "./webview-zoom"
import "./styles.css"

function NativeTheme() {
  const { resolved } = useTheme()
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      void window.api.setTitlebar({ mode: resolved, scheme: "system" })
      void window.api.setBackgroundColor(resolved === "dark" ? "#16161e" : "#fafafa")
    })
    return () => cancelAnimationFrame(frame)
  }, [resolved])
  return null
}

function DiskLizardApp() {
  const [updaterState, setUpdaterState] = useState<DiskLizardUpdaterState>({ status: "disabled" })
  const [fullscreen, setFullscreen] = useState(false)
  const base = useMemo(() => createDiskLizardPlatform(() => ({ status: "disabled" })), [])
  const platform = useMemo(() => ({ ...base, windowFullscreen: fullscreen,
    updater: base.updater ? { ...base.updater, state: updaterState } : undefined,
  }), [base, fullscreen, updaterState])
  useEffect(() => {
    let active = true
    void window.api.updater.subscribe((state) => { if (active) setUpdaterState(state) })
    void window.api.getWindowFullscreen().then((value) => { if (active) setFullscreen(value) })
    const offFullscreen = window.api.onWindowFullscreenChanged(setFullscreen)
    const offMenu = window.api.onMenuCommand((id) => {
      void handleRendererMenuCommand(id, rendererMenuHandlers({ resetZoom, zoomIn, zoomOut,
        exportLogs: () => window.api.exportDebugLogs(), menu: base.menu, runDesktopMenuAction: runRendererMenuAction }))
    })
    return () => { active = false; offFullscreen(); offMenu(); base.dispose?.() }
  }, [base])
  return <ThemeProvider><NativeTheme /><DiskMotionProvider><Toast.Region />
    <DiskLizardRuntime platform={platform}><DiskUtilityPage /></DiskLizardRuntime>
  </DiskMotionProvider></ThemeProvider>
}

async function mountDiskLizard() {
  const language = await loadRendererLanguage()
  configureDiskLanguage(language.locale, language.messages)
  document.documentElement.lang = language.intl
  document.documentElement.dir = language.direction
  await window.api.setNativeTranslations(createDesktopNativeBundle(language.locale,
    (key) => language.messages[key] ?? DESKTOP_NATIVE_ENGLISH[key])).catch(() => undefined)
  createRoot(document.getElementById("root")!).render(<DiskLizardApp />)
}
void mountDiskLizard()
