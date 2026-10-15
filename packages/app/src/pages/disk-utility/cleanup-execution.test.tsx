import { expect, test } from "bun:test"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { DiskLizardRuntime, useLanguage } from "./runtime"
import { diskUtilityFixture } from "../../fixture"
import { useCleanupExecution } from "./use-cleanup-execution"
import type { DiskDeleteAuthorizationOutcome, DiskScanNode } from "./types"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

test("single-item deletion rechecks current protection after authorization yields", async () => {
  const authorization =
    Promise.withResolvers<DiskDeleteAuthorizationOutcome[]>()
  const node: DiskScanNode = {
    name: "file",
    path: "/work/file",
    size: 10,
    isDir: false,
    ext: "",
    children: [],
  }
  let allowed = true
  let deletions = 0
  let applied = 0
  let current!: ReturnType<typeof useCleanupExecution>
  function Harness() {
    current = useCleanupExecution({
      disk: {
        ...diskUtilityFixture,
        authorizeDeletePaths: () => authorization.promise,
        deletePath: async () => {
          deletions++
          return { ok: true }
        },
      },
      os: "macos",
      language: useLanguage(),
      cleanupLocks: [],
      cleanupProtectionsReady: () => true,
      ensureCleanupProtectionsReady: () => true,
      canModifyNode: () => allowed,
      showDeveloperArtifactRescanGuidance: () => {},
      effectiveCollection: [],
      setCollection: () => {},
      collectionSurface: { close: () => {} },
      requiresDeepInventoryRefresh: () => false,
      applyDeletedNodes: () => {
        applied++
      },
      openTrash: () => {},
    })
    return null
  }
  const host = document.createElement("div")
  const root = createRoot(host)
  try {
    await act(async () =>
      root.render(
        <DiskLizardRuntime
          platform={{
            platform: "desktop",
            os: "macos",
            diskUtility: diskUtilityFixture,
          }}
        >
          <Harness />
        </DiskLizardRuntime>
      )
    )
    let deleting!: Promise<void>
    await act(async () => {
      deleting = current.trashNode(node)
    })
    allowed = false
    await act(async () => {
      authorization.resolve([{ path: node.path, authorization: "reviewed" }])
      await deleting
    })
    expect(deletions).toBe(0)
    expect(applied).toBe(0)
    expect(current.cleanupResults[0]).toMatchObject({ node, status: "failed" })
  } finally {
    await act(async () => root.unmount())
  }
})
