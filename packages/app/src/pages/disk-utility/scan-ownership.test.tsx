import { expect, test } from "bun:test"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { DiskLizardRuntime } from "./runtime"
import { diskUtilityFixture } from "../../fixture"
import { useDiskUtilityWorkspace } from "./use-disk-utility-workspace"
import type { DiskScanNode } from "./types"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

test("leaving and reopening a map retires every effect of an abandoned folder expansion", async () => {
  const cache: DiskScanNode = {
    name: "cache",
    path: "/work/cache",
    size: 10,
    isDir: true,
    isCollapsed: true,
    ext: "",
    children: [],
  }
  const tree: DiskScanNode = {
    name: "work",
    path: "/work",
    size: 10,
    isDir: true,
    ext: "",
    children: [cache],
  }
  const expanded = {
    ...cache,
    isCollapsed: false,
    children: [
      {
        name: "file",
        path: "/work/cache/file",
        size: 10,
        isDir: false,
        ext: "",
        children: [],
      },
    ],
  }
  const pending = Promise.withResolvers<DiskScanNode>()
  const cancelled: (string | undefined)[] = []
  let scans = 0
  let current!: ReturnType<typeof useDiskUtilityWorkspace>
  function Workspace() {
    current = useDiskUtilityWorkspace()
    return null
  }
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () =>
      root.render(
        <DiskLizardRuntime
          platform={{
            platform: "desktop",
            os: "macos",
            diskUtility: {
              ...diskUtilityFixture,
              chooseFolder: async () => "/work",
              scanPath: async () => (++scans === 1 ? tree : pending.promise),
              cancelScan: async (id) => {
                cancelled.push(id)
              },
            },
          }}
        >
          <Workspace />
        </DiskLizardRuntime>
      )
    )
    await act(async () => {
      await current.overview.chooseAndScan()
    })
    expect(current.view).toBe("scan")
    await act(async () => {
      current.indexPanel.drill(cache)
    })
    expect(scans).toBe(2)
    await act(async () => current.header.backToDrives())
    await act(async () =>
      current.overview.openVolumeScan(current.overview.volumeJobs[0]!)
    )
    await act(async () => {
      pending.resolve(expanded)
      await pending.promise
    })
    expect(current.landscape.viewNode?.path).toBe("/work")
    expect(current.header.browseHistory.history().current).toBe("/work")
    expect(current.overview.volumeJobs[0]?.tree?.children[0]?.children).toEqual(
      []
    )
    expect(cancelled.some((id) => id?.startsWith("expand-"))).toBe(true)
  } finally {
    pending.resolve(expanded)
    await act(async () => root.unmount())
    host.remove()
  }
})
