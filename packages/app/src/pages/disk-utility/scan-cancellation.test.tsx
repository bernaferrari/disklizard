import { expect, test } from "bun:test"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { MotionConfig } from "framer-motion"
import DiskUtilityPage from "./index"
import { createDiskLizardMenu, DiskLizardRuntime } from "./runtime"
import { diskUtilityFixture } from "../../fixture"
import type { DiskScanNode } from "./types"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

test("two Escape presses cancel a foreground rescan and ignore its late result", async () => {
  const tree: DiskScanNode = {
    name: "work",
    path: "/work",
    size: 0,
    isDir: true,
    ext: "",
    children: [],
  }
  const pending = Promise.withResolvers<DiskScanNode>()
  const cancelled: (string | undefined)[] = []
  let scans = 0
  const menu = createDiskLizardMenu()
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => {
      root.render(
        <MotionConfig skipAnimations>
          <DiskLizardRuntime
            platform={{
              platform: "desktop",
              os: "macos",
              menu,
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
            <DiskUtilityPage />
          </DiskLizardRuntime>
        </MotionConfig>
      )
    })
    await act(async () => {
      await menu.run("disk.chooseFolder")
    })
    expect(host.textContent).toContain("Clean up")
    await act(async () => {
      void menu.run("disk.rescan")
    })
    expect(scans).toBe(2)
    const escape = () =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        })
      )
    await act(async () => {
      escape()
    })
    expect(cancelled).toEqual([])
    await act(async () => {
      escape()
    })
    expect(cancelled).toHaveLength(1)
    expect(cancelled[0]).toStartWith("folder-")
    await act(async () => {
      pending.resolve(tree)
      await pending.promise
    })
    expect(host.textContent).not.toContain("Clean up")
  } finally {
    pending.resolve(tree)
    await act(async () => root.unmount())
    host.remove()
  }
})
