import { expect, test } from "bun:test"
import { act } from "react"
import { MotionConfig } from "framer-motion"
import { createRoot } from "react-dom/client"
import DiskUtilityPage from "./index"
import { createDiskLizardMenu, DiskLizardRuntime } from "./runtime"
import { diskUtilityFixture } from "../../fixture"
import type { DiskScanNode, DiskScanUpdate, DiskScanProgress } from "./types"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const folder = (
  path: string,
  size: number,
  children: DiskScanNode[] = []
): DiskScanNode => ({
  name: path.split("/").at(-1)!,
  path,
  size,
  children,
  isDir: true,
  ext: "",
  modifiedAt: Date.UTC(2025, 0, 1),
})

async function setup(
  check: (path: string) => Promise<{ state: "likely" | "denied" }>,
  customTree?: DiskScanNode
) {
  const a = folder("/work/a/node_modules", 60_000)
  const b = folder("/work/b/node_modules", 40_000)
  const tree =
    customTree ??
    folder("/work", 100_000, [
      folder("/work/a", a.size, [a]),
      folder("/work/b", b.size, [b]),
    ])
  tree.sharedStorageEvidence = "complete"
  tree.cloneMetadata = { state: "available" }
  const menu = createDiskLizardMenu()
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  let update: ((value: DiskScanUpdate) => void) | undefined
  let scanID = ""
  let progress: ((value: DiskScanProgress) => void) | undefined
  const disk = {
    ...diskUtilityFixture,
    chooseFolder: async () => tree.path,
    scanPath: async (_path: string, _options: unknown, id?: string) => {
      scanID = id!
      return tree
    },
    checkDeleteAccess: check,
    onScanUpdate: (callback: (value: DiskScanUpdate) => void) => {
      update = callback
      return () => {
        update = undefined
      }
    },
    onScanProgress: (callback: (value: DiskScanProgress) => void) => {
      progress = callback
      return () => {
        progress = undefined
      }
    },
  }
  await act(async () => {
    root.render(
      <MotionConfig skipAnimations>
        <DiskLizardRuntime
          platform={{
            platform: "desktop",
            os: "macos",
            diskUtility: disk,
            menu,
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
  const button = (text: string) =>
    [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === text
    )!
  return {
    host,
    root,
    a,
    b,
    tree,
    button,
    update: async (root: DiskScanNode) => {
      await act(async () =>
        update?.({
          scanId: scanID,
          rootPath: tree.path,
          root,
          changedPaths: ["/work/b"],
        })
      )
    },
    progress: async () => {
      await act(async () =>
        progress?.({
          scanId: scanID,
          filesScanned: 0,
          currentPath: tree.path,
          size: tree.size,
          done: true,
          source: "snapshot",
        })
      )
    },
    close: async () => {
      await act(async () => root.unmount())
      host.remove()
    },
  }
}

test("assembled cleanup checks inspection and keeps denial across focus and review", async () => {
  const checked: string[] = []
  let deny = false
  const page = await setup(async (path) => {
    checked.push(path)
    return { state: deny && path.includes("/a/") ? "denied" : "likely" }
  })
  try {
    await act(async () => page.button("Clean up").click())
    const inspect = (name: string) =>
      page.host.querySelector<HTMLButtonElement>(
        `[aria-label="Inspect ${name} / node_modules"]`
      )!
    expect(checked).toContain(page.a.path)
    expect(checked).toContain(page.b.path)
    await act(async () =>
      page.host
        .querySelector<HTMLButtonElement>(
          '[aria-label="Select a / node_modules for review"]'
        )!
        .click()
    )
    deny = true
    await act(async () => page.button("Check access again").click())
    expect(page.host.querySelector("aside")?.textContent).toContain(
      "Access denied by the filesystem"
    )
    await act(async () => inspect("b").click())
    expect(inspect("a").closest("li")?.textContent).toContain(
      "Access denied by the filesystem"
    )
    await act(async () => inspect("a").click())
    expect(page.host.querySelector("aside")?.textContent).toContain(
      "Access denied by the filesystem"
    )
    await act(async () => page.button("Move to Trash…").click())
    const dialog = document.querySelector('[role="dialog"]')!
    expect(dialog.textContent).toContain("Access denied by the filesystem")
    const confirm = [
      ...dialog.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent?.includes("Move to Trash"))!
    expect(confirm.disabled).toBe(true)
  } finally {
    await page.close()
  }
})

test("assembled map retains measured usage across queue, unqueue, and live update", async () => {
  const page = await setup(async () => ({ state: "likely" }))
  try {
    const measurement = () =>
      page.host.querySelector("[data-map-size]")?.getAttribute("data-map-size")
    expect(measurement()).toBe("100000")
    await act(async () => page.button("Clean up").click())
    await act(async () =>
      page.host
        .querySelector<HTMLButtonElement>(
          '[aria-label="Select a / node_modules for review"]'
        )!
        .click()
    )
    await act(async () => page.button("Explore").click())
    expect(measurement()).toBe("100000")
    await act(async () => page.button("Clean up").click())
    await act(async () =>
      page.host
        .querySelector<HTMLButtonElement>(
          '[aria-label="Remove a / node_modules from review"]'
        )!
        .click()
    )
    await act(async () => page.button("Explore").click())
    expect(measurement()).toBe("100000")
    const bigger = folder("/work/b/node_modules", 90_000)
    await page.update({
      ...page.tree,
      size: 150_000,
      children: [
        page.tree.children[0],
        folder("/work/b", bigger.size, [bigger]),
      ],
    })
    expect(measurement()).toBe("150000")
  } finally {
    await page.close()
  }
})

test("assembled cleanup shows full operation scope in rows, inspector, review and confirmation", async () => {
  const child = folder("/work/build/node_modules", 8_000_000_000)
  const parent = folder("/work/build", 10_000_000_000, [
    child,
    { ...folder("/work/build/source.txt", 2_000_000_000), isDir: false },
  ])
  const page = await setup(
    async () => ({ state: "likely" }),
    folder("/work", parent.size, [parent])
  )
  try {
    await act(async () => page.button("Clean up").click())
    const parentRow = page.host.querySelector<HTMLButtonElement>(
      '[aria-label="Inspect work / build"]'
    )!
    expect(parentRow.closest("li")?.textContent).toContain("10.0 GB")
    expect(
      page.host.querySelector('[aria-label="Inspect build / node_modules"]')
    ).not.toBeNull()
    await act(async () =>
      page.host
        .querySelector<HTMLButtonElement>(
          '[aria-label="Select build / node_modules for review"]'
        )!
        .click()
    )
    expect(page.host.textContent).toContain("8.00 GB selected")
    await act(async () => parentRow.click())
    expect(page.host.querySelector("aside")?.textContent).toContain("10.0 GB")
    expect(page.host.querySelector("aside")?.textContent).toContain(
      "Whole folder"
    )
    await act(async () =>
      page.host
        .querySelector<HTMLButtonElement>(
          '[aria-label="Select work / build for review"]'
        )!
        .click()
    )
    expect(page.host.textContent).toContain("10.0 GB selected")
    expect(page.host.textContent).not.toContain("18.0 GB selected")
    await act(async () => page.button("Move to Trash…").click())
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "10.0 GB"
    )
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "Move 1 item"
    )
  } finally {
    await page.close()
  }
})

test("a denied initial cleanup inspection stays inspectable after regrouping", async () => {
  const page = await setup(async (path) => ({
    state: path.includes("/a/") ? "denied" : "likely",
  }))
  try {
    await act(async () => page.button("Clean up").click())
    expect(page.host.querySelector("aside h2")?.textContent).toBe(
      "a / node_modules"
    )
    expect(page.host.querySelector("aside")?.textContent).toContain(
      "Access denied by the filesystem"
    )
    const first = page.host.querySelector<HTMLButtonElement>(
      '[aria-label="Inspect a / node_modules"]'
    )!
    expect(first.closest("details")?.textContent).toContain(
      "Unavailable for cleanup"
    )
    await act(async () =>
      page.host
        .querySelector<HTMLButtonElement>(
          '[aria-label="Inspect b / node_modules"]'
        )!
        .click()
    )
    await act(async () => first.click())
    expect(page.host.querySelector("aside")?.textContent).toContain(
      "Access denied by the filesystem"
    )
  } finally {
    await page.close()
  }
})

test("scan completion provenance survives a progress event arriving after the tree result", async () => {
  const page = await setup(async () => ({ state: "likely" }))
  try {
    await page.progress()
    expect(
      page.host.querySelector(".dl-shell")?.getAttribute("data-scan-source")
    ).toBe("snapshot")
  } finally {
    await page.close()
  }
})
