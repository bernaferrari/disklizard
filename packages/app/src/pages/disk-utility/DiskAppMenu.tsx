import { Button } from "@/components/dl/button"
import { DropdownMenu } from "@/components/dl/dropdown-menu"
import { useLanguage, usePlatform } from "./runtime"
import { useDiskActions } from "./use-disk-actions"

/** The native-style application menu owns its platform commands and labels. */
export function DiskAppMenu({
  scan,
}: {
  scan?: {
    pinned: boolean
    protected: boolean
    pinPending: boolean
    canProtect: boolean
    onPin: () => void
    onProtect: () => void
  }
}) {
  const platform = usePlatform()
  const language = useLanguage()
  const { handleUpdaterMenuAction, exportDiagnostics } = useDiskActions()
  if (platform.os === "macos") return null
  return (
    <DropdownMenu placement="bottom-start" gutter={6}>
      <DropdownMenu.Trigger
        as={Button}
        className="min-h-11 min-w-11"
        variant="ghost"
        size="small"
        icon="dot-grid"
        aria-label={language.t("disk.app.menu")}
      />
      <DropdownMenu.Portal>
        <DropdownMenu.Content>
          <DropdownMenu.Item disabled>
            <DropdownMenu.ItemLabel>
              {language.t("disk.app.about", {
                version: platform.version ?? "",
              })}
            </DropdownMenu.ItemLabel>
          </DropdownMenu.Item>
          {scan ? (
            <>
              <DropdownMenu.Separator />
              <DropdownMenu.Item
                disabled={scan.pinPending}
                onSelect={() => scan.onPin()}
              >
                <DropdownMenu.ItemLabel>
                  {scan.pinned
                    ? language.t("disk.top.unsave")
                    : language.t("disk.common.saveLocation")}
                </DropdownMenu.ItemLabel>
              </DropdownMenu.Item>
              <DropdownMenu.Item
                disabled={!scan.canProtect}
                onSelect={() => scan.onProtect()}
              >
                <DropdownMenu.ItemLabel>
                  {scan.protected
                    ? language.t("disk.top.unprotect")
                    : language.t("disk.top.protect")}
                </DropdownMenu.ItemLabel>
              </DropdownMenu.Item>
            </>
          ) : null}
          {platform.updater && platform.updater.state.status !== "disabled" ? (
            <>
              <DropdownMenu.Separator />
              <DropdownMenu.Item
                disabled={
                  platform.updater?.state.status === "checking" ||
                  platform.updater?.state.status === "downloading" ||
                  platform.updater?.state.status === "installing"
                }
                onSelect={() => void handleUpdaterMenuAction()}
              >
                <DropdownMenu.ItemLabel>
                  {(() => {
                    const state = platform.updater?.state
                    if (state?.status === "ready")
                      return language.t("disk.app.installUpdate", {
                        version: state.version,
                      })
                    if (state?.status === "checking")
                      return language.t("disk.app.updateChecking")
                    if (state?.status === "downloading")
                      return language.t("disk.app.updateDownloading", {
                        version: state.version,
                      })
                    if (state?.status === "installing")
                      return language.t("disk.app.installUpdate", {
                        version: state.version,
                      })
                    return language.t("disk.app.checkUpdates")
                  })()}
                </DropdownMenu.ItemLabel>
              </DropdownMenu.Item>
            </>
          ) : null}
          {platform.exportDiagnostics ? (
            <DropdownMenu.Item onSelect={() => void exportDiagnostics()}>
              <DropdownMenu.ItemLabel>
                {language.t("disk.app.exportDiagnostics")}
              </DropdownMenu.ItemLabel>
            </DropdownMenu.Item>
          ) : null}
          {platform.restart ? (
            <>
              <DropdownMenu.Separator />
              <DropdownMenu.Item onSelect={() => void platform.restart?.()}>
                <DropdownMenu.ItemLabel>
                  {language.t("disk.app.restart")}
                </DropdownMenu.ItemLabel>
              </DropdownMenu.Item>
            </>
          ) : null}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  )
}
