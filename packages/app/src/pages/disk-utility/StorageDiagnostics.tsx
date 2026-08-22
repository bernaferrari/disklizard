import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { For, Show } from "solid-js"
import type { DiskStorageDiagnostics, DiskStorageLocation } from "@/context/platform"

export function storageProviderLabel(provider: DiskStorageLocation["provider"]): string {
  if (provider === "google-drive") return "Google Drive"
  if (provider === "icloud") return "iCloud Drive"
  if (provider === "onedrive") return "OneDrive"
  if (provider === "network") return "Network location"
  if (provider === "other") return "Cloud storage"
  return provider[0].toUpperCase() + provider.slice(1)
}

export function shouldShowStorageDiagnostics(diagnostics?: DiskStorageDiagnostics): boolean {
  return !!diagnostics && (diagnostics.locations.length > 0 || diagnostics.access.status === "limited")
}

export function StorageDiagnostics(props: {
  diagnostics?: DiskStorageDiagnostics
  onScan: (location: DiskStorageLocation) => void
  onOpenAccessSettings?: () => void
}) {
  const locations = () => props.diagnostics?.locations ?? []
  const accessLimited = () => props.diagnostics?.access.status === "limited"
  if (!shouldShowStorageDiagnostics(props.diagnostics)) return null

  return (
    <section class="pt-7" aria-labelledby="disklizard-connected-storage">
      <div class="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p class="text-13-semibold uppercase tracking-[0.14em] text-text-weaker">Connected storage</p>
          <h3 id="disklizard-connected-storage" class="mt-1 text-18-medium tracking-[-0.02em] text-text-strong">
            Scan storage that is already mounted.
          </h3>
        </div>
        <span class="text-13-regular text-text-weaker">Nothing is signed in or uploaded</span>
      </div>

      <Show when={accessLimited()}>
        <div class="mb-3 flex flex-wrap items-center gap-3 rounded-2xl border border-border-warning-base/50 bg-surface-warning-weak/42 px-4 py-3">
          <span class="grid size-9 shrink-0 place-items-center rounded-xl bg-background-base/60 text-icon-warning-base">
            <Icon name="shield" class="size-4" />
          </span>
          <div class="min-w-[min(100%,24rem)] flex-1">
            <p class="text-13-semibold text-text-strong">Some protected folders could not be read</p>
            <p class="mt-0.5 max-w-[58ch] text-13-regular leading-relaxed text-text-weak">
              DiskLizard observed an OS permission denial. Open privacy settings to review access, then rescan—access is
              never assumed.
            </p>
          </div>
          <Show when={props.onOpenAccessSettings}>
            <Button class="dl-touch-target" size="small" variant="secondary" icon="square-arrow-top-right" onClick={props.onOpenAccessSettings}>
              Open privacy settings
            </Button>
          </Show>
        </div>
      </Show>

      <Show when={locations().length > 0}>
        <div class="grid gap-3 md:grid-cols-2">
          <For each={locations()}>
            {(location) => (
              <button
                type="button"
                class="dl-hover-card dl-touch-target group flex min-h-[88px] min-w-0 items-center gap-3 rounded-2xl bg-surface-raised-strong px-4 py-3 text-left shadow-[0_0_0_1px_rgb(127_127_127/0.11),0_8px_28px_-22px_rgb(0_0_0/0.22)] outline-none transition-[background-color,box-shadow,transform] duration-150 focus-visible:ring-2 focus-visible:ring-text-weak active:scale-[0.99]"
                onClick={() => props.onScan(location)}
                aria-label={`Scan ${location.name}, ${storageProviderLabel(location.provider)}`}
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
                <span class="shrink-0 text-13-semibold text-text-weak">Scan</span>
              </button>
            )}
          </For>
        </div>
      </Show>
    </section>
  )
}
