import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { For, Show } from "solid-js"
import type { DiskStorageDiagnostics, DiskStorageLocation } from "./types"
import { diskLanguageText, useLanguage } from "./runtime"

export function storageProviderLabel(provider: DiskStorageLocation["provider"]): string {
  if (provider === "google-drive") return diskLanguageText("disk.storage.provider.googleDrive")
  if (provider === "icloud") return diskLanguageText("disk.storage.provider.icloud")
  if (provider === "onedrive") return diskLanguageText("disk.storage.provider.onedrive")
  if (provider === "network") return diskLanguageText("disk.storage.provider.network")
  if (provider === "other") return diskLanguageText("disk.storage.provider.other")
  return provider[0].toUpperCase() + provider.slice(1)
}

export function shouldShowStorageDiagnostics(diagnostics?: DiskStorageDiagnostics): boolean {
  return !!diagnostics && (diagnostics.locations.length > 0 || !!storageAccessGuidance(diagnostics))
}

export function storageAccessGuidance(diagnostics: DiskStorageDiagnostics) {
  const access = diagnostics.access
  if (access.wholeVolume.mapCoverage === "may-be-incomplete" || access.status === "limited") {
    return {
      title: diskLanguageText("disk.storage.accessTitle"),
      body:
        access.wholeVolume.capability === "windows-elevated-token"
          ? diskLanguageText("disk.storage.accessWindowsBody")
          : diskLanguageText("disk.storage.accessBody"),
    }
  }
  if (access.wholeVolume.status === "inconclusive" || access.wholeVolume.mapCoverage === "unknown") {
    return {
      title: diskLanguageText("disk.storage.accessUnknownTitle"),
      body: diskLanguageText("disk.storage.accessUnknownBody"),
    }
  }
}

export function StorageDiagnostics(props: {
  diagnostics?: DiskStorageDiagnostics
  onScan: (location: DiskStorageLocation) => void
  onOpenAccessSettings?: () => void
}) {
  const language = useLanguage()
  const locations = () => props.diagnostics?.locations ?? []
  const accessGuidance = () => (props.diagnostics ? storageAccessGuidance(props.diagnostics) : undefined)
  if (!shouldShowStorageDiagnostics(props.diagnostics)) return null

  return (
    <section class="border-t border-border-weaker-base py-6" aria-labelledby="disklizard-connected-storage">
      <div class="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <h3 id="disklizard-connected-storage" class="text-13-semibold text-text-strong">
          {language.t("disk.storage.connected")}
        </h3>
        <span class="text-13-regular text-text-weaker">{language.t("disk.storage.mountedMac")}</span>
      </div>

      <Show when={accessGuidance()}>
        {(guidance) => (
        <div class="mb-3 flex flex-wrap items-center gap-3 rounded-2xl border border-border-warning-base/50 bg-surface-warning-weak/42 px-4 py-3">
          <span class="grid size-9 shrink-0 place-items-center rounded-xl bg-background-base/60 text-icon-warning-base">
            <Icon name="shield" class="size-4" />
          </span>
          <div class="min-w-[min(100%,24rem)] flex-1">
            <p class="text-13-semibold text-text-strong">{guidance().title}</p>
            <p class="mt-0.5 max-w-[58ch] text-13-regular leading-relaxed text-text-weak">{guidance().body}</p>
          </div>
          <Show when={props.onOpenAccessSettings}>
            <Button class="dl-touch-target" size="small" variant="secondary" icon="square-arrow-top-right" onClick={props.onOpenAccessSettings}>
              {language.t("disk.explore.openPrivacy")}
            </Button>
          </Show>
        </div>
        )}
      </Show>

      <Show when={locations().length > 0}>
        <div class="grid gap-3 md:grid-cols-2">
          <For each={locations()}>
            {(location) => (
              <button
                type="button"
                class="dl-hover-card dl-touch-target group flex min-h-[88px] min-w-0 items-center gap-3 rounded-2xl bg-surface-raised-strong px-4 py-3 text-left shadow-[0_0_0_1px_rgb(127_127_127/0.11),0_8px_28px_-22px_rgb(0_0_0/0.22)] outline-none transition-[background-color,box-shadow,transform] duration-150 focus-visible:ring-2 focus-visible:ring-text-weak active:scale-[0.99]"
                onClick={() => props.onScan(location)}
                aria-label={language.t("disk.storage.scanLocation", {
                  name: location.name,
                  provider: storageProviderLabel(location.provider),
                })}
              >
                <span class="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-raised-base text-text-weak shadow-[inset_0_0_0_1px_rgb(127_127_127/0.1)]">
                  <Icon name="server" class="size-4" />
                </span>
                <span class="min-w-0 flex-1">
                  <span class="flex min-w-0 items-center gap-2">
                    <span class="dl-hover-card-label truncate text-13-semibold text-text-strong">{location.name}</span>
                    <span class="shrink-0 rounded-full bg-surface-raised-base px-1.5 py-0.5 text-13-semibold text-text-weaker">
                      {storageProviderLabel(location.provider)}
                    </span>
                  </span>
                  <span class="mt-1 block truncate text-13-mono text-text-weaker" title={location.path}>
                    {location.path}
                  </span>
                </span>
                <span class="shrink-0 text-13-semibold text-text-weak">{language.t("disk.common.scan")}</span>
              </button>
            )}
          </For>
        </div>
      </Show>
    </section>
  )
}
