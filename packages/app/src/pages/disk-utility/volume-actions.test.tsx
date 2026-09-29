import { expect, test } from "bun:test"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { diskUtilityFixture } from "../../fixture"
import { DiskLizardRuntime } from "./runtime"
import { VolumeRow } from "./DiskUtilityDriveSurfaces"
import type { DiskDriveInfo } from "./types"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

test("a retained volume map opens from View and offers Re-scan in its menu", async () => {
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  const drive: DiskDriveInfo = {
    path: "/",
    name: "Macintosh HD",
    label: "Macintosh HD",
    total: 100,
    free: 20,
    used: 80,
    type: "local",
    filesystem: "apfs",
  }
  let views = 0
  let scans = 0
  try {
    await act(async () => {
      root.render(
        <DiskLizardRuntime
          platform={{
            platform: "desktop",
            os: "macos",
            diskUtility: diskUtilityFixture,
          }}
        >
          <VolumeRow
            drive={drive}
            canStart
            primary
            hasRetainedMap
            onOpenRetainedMap={() => views++}
            onScan={() => scans++}
            onCancel={() => {}}
            onOpen={() => {}}
          />
        </DiskLizardRuntime>
      )
    })
    const view = host.querySelector<HTMLButtonElement>("[data-disk-primary-action]")
    expect(view?.textContent).toBe("View")
    expect(host.textContent).toContain("Map ready")
    await act(async () => view?.click())
    expect(views).toBe(1)
    expect(scans).toBe(0)

    const menu = host.querySelector<HTMLButtonElement>('[aria-label="Volume actions"]')
    await act(async () => menu?.click())
    const rescan = [...document.querySelectorAll<HTMLElement>("[role=menuitem]")]
      .find((item) => item.textContent?.includes("Re-scan"))
    expect(rescan).toBeDefined()
    await act(async () => rescan?.click())
    expect(scans).toBe(1)
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
