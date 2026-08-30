import { Font } from "@opencode-ai/ui/font"
import { I18nProvider } from "@opencode-ai/ui/context/i18n"
import { Toast } from "@opencode-ai/ui/toast"
import { createSignal, onCleanup } from "solid-js"
import { render } from "solid-js/web"
import {
  configureDiskLanguage,
  DiskUtilityPage,
  DiskLizardRuntime,
  type DiskLizardUpdaterState,
} from "@disklizard/app"
import { createDesktopNativeBundle, DESKTOP_NATIVE_ENGLISH } from "@disklizard/app/native-i18n"
import { createRendererUiI18n, loadRendererLanguage, type RendererLanguage } from "./i18n"
import { handleRendererMenuCommand, rendererMenuHandlers } from "./menu-commands"
import { createDiskLizardPlatform, runRendererMenuAction } from "./platform"
import { DiskLizardTheme } from "./disklizard-theme"
import { resetZoom, zoomIn, zoomOut } from "./webview-zoom"
import "./styles.css"

const root = document.getElementById("root")
if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
  throw new Error("DiskLizard renderer root was not found")
}

function DiskLizardApp(props: { language: RendererLanguage }) {
  const [updaterState, setUpdaterState] = createSignal<DiskLizardUpdaterState>({ status: "disabled" })
  void window.api.updater.subscribe(setUpdaterState)
  const platform = createDiskLizardPlatform(updaterState)
  const uiI18n = createRendererUiI18n(props.language)
  onCleanup(() => platform.dispose?.())

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
    <DiskLizardTheme
      onThemeApplied={(mode, background) => {
        void window.api.setTitlebar({ mode, scheme: "system" })
        void window.api.setBackgroundColor(background)
      }}
    >
      <I18nProvider value={uiI18n}>
        <Font />
        <Toast.Region />
        <DiskLizardRuntime platform={platform}>
          <DiskUtilityPage />
        </DiskLizardRuntime>
      </I18nProvider>
    </DiskLizardTheme>
  )
}

async function mountDiskLizard() {
  const language = await loadRendererLanguage()
  configureDiskLanguage(language.locale, language.messages)
  document.documentElement.lang = language.intl
  document.documentElement.dir = language.direction
  await window.api
    .setNativeTranslations(
      createDesktopNativeBundle(language.locale, (key) => language.messages[key] ?? DESKTOP_NATIVE_ENGLISH[key]),
    )
    .catch(() => undefined)
  render(() => <DiskLizardApp language={language} />, root!)
}

void mountDiskLizard()
