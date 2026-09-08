import { Button } from "@/components/dl/button"
import { Collapsible } from "@base-ui/react/collapsible"
import { ChevronDown, Cloud, Network, ShieldCheck, CircleAlert } from "lucide-react"
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

export function shouldShowStorageDiagnostics(diagnostics?: DiskStorageDiagnostics, error = false): boolean {
  return error || (!!diagnostics && (diagnostics.locations.length > 0 || !!storageAccessGuidance(diagnostics)))
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
  error?: boolean
  onScan: (location: DiskStorageLocation) => void
  onOpenAccessSettings?: () => void
  onRetry?: () => void
}) {
  const language = useLanguage()
  const locations = props.diagnostics?.locations ?? []
  const accessGuidance = props.diagnostics ? storageAccessGuidance(props.diagnostics) : undefined
  if (!shouldShowStorageDiagnostics(props.diagnostics, props.error)) return null

  return (
    <Collapsible.Root className="py-2">
      <Collapsible.Trigger className="group flex min-h-10 w-full items-center gap-2 rounded-md text-left text-13-medium text-text-weak outline-none hover:text-text-strong focus-visible:ring-2 focus-visible:ring-ring">
        <ChevronDown aria-hidden className="size-3.5 -rotate-90 transition-transform duration-150 group-aria-expanded:rotate-0 motion-reduce:transition-none" />
        <span>{language.t("disk.storage.connected")}</span>
        {locations.length > 0 && <span className="ml-1 text-text-weaker tabular-nums">{locations.length}</span>}
      </Collapsible.Trigger>
      <Collapsible.Panel className="pt-2">
        {locations.length > 0 && (
          <ul className="overflow-hidden rounded-xl bg-surface-raised-base divide-y divide-border-weaker-base">
            {locations.map((location) => {
              const provider = storageProviderLabel(location.provider)
              const StorageIcon = location.provider === "network" ? Network : Cloud
              const duplicate = locations.some((other) => other.path !== location.path && other.name === location.name)
              return (
                <li key={location.path} className="flex min-h-16 items-center gap-4 px-5 py-3">
                  <StorageIcon aria-hidden className="size-6 shrink-0 text-text-weak" strokeWidth={1.5} />
                  <div className="min-w-0 flex-1" title={location.path}>
                    <p className="truncate text-13-medium text-text-strong">{location.name}</p>
                    {duplicate ? (
                      <p className="mt-0.5 truncate text-12-regular text-text-weaker">{location.path}</p>
                    ) : provider.toLowerCase() !== location.name.toLowerCase() ? (
                      <p className="mt-0.5 truncate text-12-regular text-text-weaker">{provider}</p>
                    ) : null}
                  </div>
                  <Button size="small" variant="secondary" onClick={() => props.onScan(location)}
                    aria-label={language.t("disk.storage.scanLocation", { name: location.name, provider })}>
                    {language.t("disk.common.scan")}
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
        {(props.error || accessGuidance) && (
          <div className="mt-3 flex items-start gap-2.5 px-1 py-2 text-text-weaker" role="status">
            {props.error ? <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" /> : <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0" />}
            <details className="min-w-0 flex-1 text-12-regular">
              <summary className="w-fit cursor-pointer rounded-sm leading-5 outline-none hover:text-text-strong focus-visible:ring-2 focus-visible:ring-ring">
                {props.error ? language.t("disk.storage.diagnosticsErrorTitle") : accessGuidance?.title}
              </summary>
              <p className="mt-2 max-w-[65ch] leading-relaxed">
                {props.error ? language.t("disk.storage.diagnosticsErrorBody") : accessGuidance?.body}
              </p>
              {props.error && props.onRetry ? (
                <Button className="mt-2" size="small" variant="ghost" onClick={props.onRetry}>
                  {language.t("disk.storage.retryDiagnostics")}
                </Button>
              ) : !props.error && props.onOpenAccessSettings ? (
                <Button className="mt-2" size="small" variant="ghost" onClick={props.onOpenAccessSettings}>
                  {language.t("disk.explore.openPrivacy")}
                </Button>
              ) : null}
            </details>
          </div>
        )}
      </Collapsible.Panel>
    </Collapsible.Root>
  )
}
