import { MAX_PARALLEL_VOLUME_SCANS } from "./background-scans"
import { DriveOverview } from "./DiskUtilityDriveOverview"
import { driveForPath } from "./storage"
import type { usePlatform } from "./runtime"
import type {
  DiskScanNode,
  DiskDriveInfo,
  DiskStorageDiagnostics,
  DiskStorageLocation,
  DiskCleanupLock,
  DiskPinnedLocation,
} from "./types"
import type { ScanTab } from "./scan-tabs"
import type { VolumeScanJob } from "./scan-jobs"
import type { RetainedLocationCandidate } from "./retained-location"

export type DiskWorkspaceOverviewProps = {
  platform: ReturnType<typeof usePlatform>
  togglePinnedLocation: (path: string, label: string) => Promise<void>
  toggleProtectedTree: (path: string, label: string) => Promise<void>
  drives: DiskDriveInfo[]
  drivesLoading: boolean
  drivesError: string | undefined
  runningVolumeScans: number
  storageDiagnostics: DiskStorageDiagnostics | undefined
  storageDiagnosticsError: boolean
  tabs: ScanTab[]
  pinnedLocations: DiskPinnedLocation[]
  volumeJobForDrive: (drive: DiskDriveInfo) => VolumeScanJob | undefined
  chooseAndScan: () => Promise<void>
  startVolumeScan: (drive: DiskDriveInfo) => void
  cancelVolumeScan: (id: string) => void
  openVolumeScan: (job: VolumeScanJob, target?: DiskScanNode) => void
  volumeJobs: VolumeScanJob[]
  closeVolumeScan: (id: string) => void
  retainedLocation: (path: string) =>
    | {
        candidate: RetainedLocationCandidate<"active" | "tab" | "volume">
        node: DiskScanNode
      }
    | undefined
  activateStorageLocation: (location: DiskStorageLocation) => void
  openDiskAccessSettings: () => Promise<void>
  loadStorageDiagnostics: () => Promise<void>
  switchToTab: (id: string, target?: DiskScanNode) => void
  closeTab: (id: string) => void
  openRetainedLocation: (path: string) => boolean
  startScan: (
    path: string,
    label: string,
    drive?: DiskDriveInfo,
    preserveCurrent?: boolean,
    forceFresh?: boolean
  ) => Promise<void>
  cleanupLocks: DiskCleanupLock[]
}

export function DiskWorkspaceOverview({
  platform,
  togglePinnedLocation,
  toggleProtectedTree,
  drives,
  drivesLoading,
  drivesError,
  runningVolumeScans,
  storageDiagnostics,
  storageDiagnosticsError,
  tabs,
  pinnedLocations,
  volumeJobForDrive,
  chooseAndScan,
  startVolumeScan,
  cancelVolumeScan,
  openVolumeScan,
  volumeJobs,
  closeVolumeScan,
  retainedLocation,
  activateStorageLocation,
  openDiskAccessSettings,
  loadStorageDiagnostics,
  switchToTab,
  closeTab,
  openRetainedLocation,
  startScan,
  cleanupLocks,
}: DiskWorkspaceOverviewProps) {
  return (
    <DriveOverview
      drives={drives}
      loading={drivesLoading}
      error={drivesError}
      runningScans={runningVolumeScans}
      maxParallelScans={MAX_PARALLEL_VOLUME_SCANS}
      diagnostics={storageDiagnostics}
      diagnosticsError={storageDiagnosticsError}
      openMaps={tabs}
      pinnedLocations={pinnedLocations}
      jobForDrive={volumeJobForDrive}
      onChooseFolder={() => void chooseAndScan()}
      onScanDrive={startVolumeScan}
      onCancelDrive={cancelVolumeScan}
      onOpenDrive={openVolumeScan}
      folderJobs={volumeJobs.filter((job) => job.kind === "folder")}
      onCloseJob={closeVolumeScan}
      canViewLocation={(path) => !!retainedLocation(path)}
      onActivateStorageLocation={activateStorageLocation}
      onOpenAccessSettings={() => void openDiskAccessSettings()}
      onRetryDiagnostics={() => void loadStorageDiagnostics()}
      onOpenMap={(map) => {
        switchToTab(map.id)
      }}
      onCloseMap={(map) => closeTab(map.id)}
      onActivatePinnedLocation={(location) => {
        if (openRetainedLocation(location.path)) return
        void startScan(
          location.path,
          location.label,
          driveForPath(location.path, drives, platform.os)
        )
      }}
      onRemovePinnedLocation={(location) =>
        void togglePinnedLocation(location.path, location.label)
      }
      cleanupLocks={cleanupLocks}
      onUnlockCleanupLock={(location) =>
        void toggleProtectedTree(location.path, location.label)
      }
    />
  )
}
