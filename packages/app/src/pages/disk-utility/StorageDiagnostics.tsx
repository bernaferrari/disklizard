import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Button } from "@/components/dl/button"
import { Collapsible } from "@base-ui/react/collapsible"
import { ChevronDown, Cloud, Network, CircleAlert, Info } from "lucide-react"
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
    access.wholeVolume.status === "inconclusive" ||
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

export function StorageDiagnostics(props: {
  inline?: boolean
  diagnostics?: DiskStorageDiagnostics
  error?: boolean
  onScan: (location: DiskStorageLocation) => void
  onOpenAccessSettings?: () => void
  onRetry?: () => void
}) {
  const language = useLanguage()
  const locations = props.diagnostics?.locations ?? []
  const accessGuidance = props.diagnostics
    ? storageAccessGuidance(props.diagnostics)
    : undefined
  if (!shouldShowStorageDiagnostics(props.diagnostics, props.error)) return null

  return (
    <Collapsible.Root className={props.inline ? "contents" : "py-2"}>
      <Collapsible.Trigger
        className={`group flex min-h-9 items-center gap-2 rounded-md border border-border-weaker-base bg-surface-raised-base px-3 text-xs text-text-weak outline-none hover:text-text-strong focus-visible:ring-2 focus-visible:ring-ring ${props.inline ? "justify-self-end" : "w-full text-left"}`}
      >
        <ChevronDown
          aria-hidden
          className="size-3.5 -rotate-90 transition-transform duration-150 group-aria-expanded:rotate-0 motion-reduce:transition-none"
        />
        <span>{language.t("disk.storage.connected")}</span>
        {locations.length > 0 && (
          <span className="ml-1 text-text-weaker tabular-nums">
            {locations.length}
          </span>
        )}
      </Collapsible.Trigger>
      <Collapsible.Panel className={props.inline ? "col-span-2 pt-2" : "pt-2"}>
        {locations.length > 0 && (
          <ul className="grid grid-cols-2 gap-2 max-sm:grid-cols-1">
            {locations.map((location) => {
              const provider = storageProviderLabel(location.provider)
              const StorageIcon =
                location.provider === "network" ? Network : Cloud
              const duplicate = locations.some(
                (other) =>
                  other.path !== location.path && other.name === location.name
              )
              return (
                <li
                  key={location.path}
                  className="flex min-h-16 items-center gap-3 rounded-lg border border-border-weak-base bg-background-base px-3 py-3"
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-raised-strong text-text-strong">
                    <StorageIcon
                      aria-hidden
                      className="size-5"
                      strokeWidth={1.5}
                    />
                  </span>
                  <div className="min-w-0 flex-1" title={location.path}>
                    <p className="text-13-medium truncate text-text-strong">
                      {location.name}
                    </p>
                    {duplicate ? (
                      <p className="text-12-regular mt-0.5 truncate text-text-weaker">
                        {location.path}
                      </p>
                    ) : provider.toLowerCase() !==
                      location.name.toLowerCase() ? (
                      <p className="text-12-regular mt-0.5 truncate text-text-weaker">
                        {provider}
                      </p>
                    ) : null}
                  </div>
                  <Button
                    className="shrink-0 border border-border-weaker-base"
                    size="small"
                    variant="secondary"
                    onClick={() => props.onScan(location)}
                    aria-label={language.t("disk.storage.scanLocation", {
                      name: location.name,
                      provider,
                    })}
                  >
                    {language.t("disk.common.scan")}
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
        {(props.error || accessGuidance) && (
          <div className="mt-2 flex justify-end">
            <Popover>
              <PopoverTrigger className="flex min-h-9 items-center gap-1.5 rounded-md px-2 text-xs text-text-weak hover:bg-surface-raised-base focus-visible:outline-2 focus-visible:outline-text-weak">
                {props.error || accessGuidance?.attention ? (
                  <CircleAlert aria-hidden className="size-3.5" />
                ) : (
                  <Info aria-hidden className="size-3.5" />
                )}
                {language.t("disk.storage.accessDetails")}
              </PopoverTrigger>
              <PopoverContent
                align="end"
                className="w-[min(340px,calc(100vw-32px))] rounded-xl bg-surface-raised-base p-4 text-text-strong"
              >
                <PopoverTitle className="text-sm font-medium">
                  {props.error
                    ? language.t("disk.storage.diagnosticsErrorTitle")
                    : accessGuidance?.title}
                </PopoverTitle>
                <p className="mt-2 text-xs leading-relaxed text-text-weak">
                  {props.error
                    ? language.t("disk.storage.diagnosticsErrorBody")
                    : accessGuidance?.body}
                </p>
                {props.error && props.onRetry ? (
                  <Button
                    className="mt-3"
                    size="small"
                    variant="secondary"
                    onClick={props.onRetry}
                  >
                    {language.t("disk.storage.retryDiagnostics")}
                  </Button>
                ) : !props.error &&
                  accessGuidance?.attention &&
                  props.onOpenAccessSettings ? (
                  <Button
                    className="mt-3"
                    size="small"
                    variant="secondary"
                    onClick={props.onOpenAccessSettings}
                  >
                    {language.t("disk.explore.openPrivacy")}
                  </Button>
                ) : null}
              </PopoverContent>
            </Popover>
          </div>
        )}
      </Collapsible.Panel>
    </Collapsible.Root>
  )
}
