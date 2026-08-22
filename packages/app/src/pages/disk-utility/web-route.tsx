import { usePlatform as useAppPlatform } from "@/context/platform"
import DiskUtilityPage from "./index"
import { DiskLizardRuntime, type DiskLizardPlatform } from "./runtime"

/** Compatibility wrapper for the leftover OpenCode web `/disk` route. */
export default function DiskUtilityWebRoute() {
  const platform = useAppPlatform()
  if (platform.platform !== "desktop" || !platform.diskUtility) return null
  const value: DiskLizardPlatform = {
    platform: "desktop",
    os: platform.os,
    version: platform.version,
    diskUtility: platform.diskUtility,
    openPath: platform.openPath,
    getPathForFile: platform.getPathForFile,
    storage: platform.storage,
  }
  return (
    <DiskLizardRuntime platform={value}>
      <DiskUtilityPage />
    </DiskLizardRuntime>
  )
}
