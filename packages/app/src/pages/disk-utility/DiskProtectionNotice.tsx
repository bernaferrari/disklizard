import { Button } from "@/components/dl/button"
import { Icon } from "@/components/dl/icon"
import type {
  useLanguage,
  useSettings,
  DiskCleanupLocksStatus,
} from "./runtime"
import type { useSurfacePresence } from "./motion"

export type DiskProtectionNoticeProps = {
  language: ReturnType<typeof useLanguage>
  activeDialog: string | null
  cleanupProtectionsReady: () => boolean
  cleanupLocksStatus: DiskCleanupLocksStatus
  settings: ReturnType<typeof useSettings>
  cleanupResetSurface: ReturnType<typeof useSurfacePresence>
}

export function DiskProtectionNotice({
  language,
  activeDialog,
  cleanupProtectionsReady,
  cleanupLocksStatus,
  settings,
  cleanupResetSurface,
}: DiskProtectionNoticeProps) {
  return (
    <>
      {" "}
      {!cleanupProtectionsReady() ? (
        <div
          className="text-12-regular relative z-10 flex min-h-11 shrink-0 items-center gap-3 border-y border-icon-warning-base/35 bg-surface-warning-base/55 px-5 py-2 text-text-strong"
          role={cleanupLocksStatus === "error" ? "alert" : "status"}
          aria-live={cleanupLocksStatus === "error" ? "assertive" : "polite"}
          inert={activeDialog ? true : undefined}
          aria-hidden={activeDialog ? "true" : undefined}
        >
          <Icon
            name="shield"
            className="size-4 shrink-0 text-icon-warning-base"
          />
          <div className="min-w-0 flex-1">
            <span className="text-12-medium">
              {language.t(
                cleanupLocksStatus === "loading"
                  ? "disk.cleanup.protectionsLoadingTitle"
                  : cleanupLocksStatus === "saving"
                    ? "disk.cleanup.protectionsSavingTitle"
                    : "disk.cleanup.protectionsErrorTitle"
              )}
            </span>{" "}
            <span className="text-text-weak">
              {language.t(
                cleanupLocksStatus === "loading"
                  ? "disk.cleanup.protectionsLoading"
                  : cleanupLocksStatus === "saving"
                    ? "disk.cleanup.protectionsSaving"
                    : "disk.cleanup.protectionsError"
              )}
            </span>
          </div>
          {cleanupLocksStatus === "error" ? (
            <div className="flex shrink-0 items-center gap-2">
              <Button
                className="min-h-8 min-w-8"
                variant="secondary"
                size="small"
                onClick={() =>
                  void settings.store.general.retryDiskCleanupLocks()
                }
              >
                {language.t("disk.cleanup.retryProtections")}
              </Button>
              <Button
                className="min-h-8 min-w-8"
                variant="ghost"
                size="small"
                onClick={() => cleanupResetSurface.open()}
              >
                {language.t("disk.cleanup.resetProtections")}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}{" "}
    </>
  )
}
