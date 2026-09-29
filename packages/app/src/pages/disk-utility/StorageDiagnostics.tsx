import { Cloud, Network } from "lucide-react"
import type { DiskStorageDiagnostics, DiskStorageLocation } from "./types"
import { diskLanguageText, useLanguage } from "./runtime"

export function storageProviderLabel(
  provider: DiskStorageLocation["provider"]
): string {
  if (provider === "google-drive")
    return diskLanguageText("disk.storage.provider.googleDrive")
  if (provider === "icloud")
    return diskLanguageText("disk.storage.provider.icloud")
  if (provider === "onedrive")
    return diskLanguageText("disk.storage.provider.onedrive")
  if (provider === "network")
    return diskLanguageText("disk.storage.provider.network")
  if (provider === "other")
    return diskLanguageText("disk.storage.provider.other")
  return provider[0].toUpperCase() + provider.slice(1)
}

export function shouldShowStorageDiagnostics(
  diagnostics?: DiskStorageDiagnostics,
  error = false
): boolean {
  return (
    error ||
    (!!diagnostics &&
      (diagnostics.locations.length > 0 ||
        !!storageAccessGuidance(diagnostics)))
  )
}

export function storageAccessGuidance(diagnostics: DiskStorageDiagnostics) {
  const access = diagnostics.access
  if (
    access.wholeVolume.mapCoverage === "may-be-incomplete" ||
    access.status === "limited"
  ) {
    return {
      title: diskLanguageText("disk.storage.accessTitle"),
      attention: true,
      body:
        access.wholeVolume.capability === "windows-elevated-token"
          ? diskLanguageText("disk.storage.accessWindowsBody")
          : diskLanguageText("disk.storage.accessBody"),
    }
  }
  if (
    access.wholeVolume.capability === "macos-full-disk-access" &&
    access.wholeVolume.status === "inconclusive" &&
    access.wholeVolume.mapCoverage === "unknown"
  ) {
    return {
      title: diskLanguageText("disk.storage.accessUnknownTitle"),
      attention: false,
      body: diskLanguageText("disk.storage.accessUnknownBody"),
    }
  }
  return undefined
}

/**
 * Mounted cloud and network storage, offered as one-click scan targets. Only
 * shown when something is mounted; access notes live where they are actionable.
 */
export function StorageDiagnostics(props: {
  inline?: boolean
  diagnostics?: DiskStorageDiagnostics
  error?: boolean
  onActivate: (location: DiskStorageLocation) => void
  canView?: (location: DiskStorageLocation) => boolean
  onOpenAccessSettings?: () => void
  onRetry?: () => void
}) {
  const language = useLanguage()
  const locations = props.diagnostics?.locations ?? []
  if (!locations.length) return null
  return (
    <ul className="flex flex-col gap-2">
      {locations.map((location) => {
        const canView = props.canView?.(location) ?? false
        const provider = storageProviderLabel(location.provider)
        const StorageIcon = location.provider === "network" ? Network : Cloud
        const duplicate = locations.some(
          (other) =>
            other.path !== location.path && other.name === location.name
        )
        return (
          <li
            key={location.path}
            className="flex items-center gap-4 rounded-2xl bg-[var(--dl-well)] px-5 py-3.5 shadow-[inset_0_0_0_0.5px_var(--dl-separator)]"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--dl-well-strong)] text-text-weak">
              <StorageIcon aria-hidden className="size-5" strokeWidth={1.6} />
            </span>
            <div className="min-w-0 flex-1" title={location.path}>
              <p className="truncate text-[14px] font-medium text-text-strong">
                {location.name}
              </p>
              {duplicate ||
              provider.toLowerCase() !== location.name.toLowerCase() ? (
                <p className="truncate text-[12.5px] text-text-weak">
                  {duplicate ? location.path : provider}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              className="inline-flex h-9 min-w-[88px] items-center justify-center rounded-full bg-[var(--dl-well-strong)] px-5 text-[13px] font-semibold text-text-strong transition-[filter] outline-none hover:brightness-125 focus-visible:ring-2 focus-visible:ring-[var(--dl-focus)]"
              onClick={() => props.onActivate(location)}
              aria-label={
                canView
                  ? language.t("disk.drive.viewLabel", { name: location.name })
                  : language.t("disk.storage.scanLocation", {
                      name: location.name,
                      provider,
                    })
              }
            >
              {language.t(
                canView ? "disk.drive.action.view" : "disk.common.scan"
              )}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
