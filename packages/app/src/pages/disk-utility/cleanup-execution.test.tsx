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
    allowed = true
    await act(async () => current.trashNode(node))
    expect(deletions).toBe(1)
    expect(applied).toBe(1)
  } finally {
    await act(async () => root.unmount())
  }
})

test.each([
  ["single", "single"],
  ["collection", "collection"],
  ["single", "collection"],
  ["collection", "single"],
] as const)(
  "overlapping %s and %s confirmations perform one cleanup",
  async (first, second) => {
    const node: DiskScanNode = {
      name: "file",
      path: "/work/file",
      size: 10,
      isDir: false,
      ext: "",
      children: [],
    }
    const removal = Promise.withResolvers<{ ok: true }>()
    let authorizations = 0
    let deletions = 0
    let reconciliations = 0
    let current!: ReturnType<typeof useCleanupExecution>
    function Harness() {
      current = useCleanupExecution({
        disk: {
          ...diskUtilityFixture,
          authorizeDeletePaths: async () => {
            authorizations++
            return [
              { path: node.path, authorization: `reviewed-${authorizations}` },
            ]
          },
          deletePath: async () => {
            deletions++
            return removal.promise
          },
        },
        os: "macos",
        language: useLanguage(),
        cleanupLocks: [],
        cleanupProtectionsReady: () => true,
        ensureCleanupProtectionsReady: () => true,
        canModifyNode: () => true,
        showDeveloperArtifactRescanGuidance: () => {},
        effectiveCollection: [node],
        setCollection: () => {},
        collectionSurface: { close: () => {} },
        requiresDeepInventoryRefresh: () => false,
        applyDeletedNodes: () => {
          reconciliations++
        },
        openTrash: () => {},
      })
      return null
    }
    const root = createRoot(document.createElement("div"))
    const pending: Promise<void>[] = []
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
      const invoke = (kind: "single" | "collection") =>
        kind === "single" ? current.trashNode(node) : current.deleteCollected()
      await act(async () => {
        pending.push(invoke(first), invoke(second))
      })
      expect(authorizations).toBe(1)
      expect(deletions).toBe(1)
      // Keep the first operation pending across a React render: rendered busy
      // state and the synchronous exclusion must describe the same lifetime.
      await act(async () => {
        pending.push(invoke(second))
      })
      expect(authorizations).toBe(1)
      await act(async () => {
        removal.resolve({ ok: true })
        await Promise.all(pending)
      })
      expect(reconciliations).toBe(1)
      expect(current.deleting).toBe(false)
    } finally {
      await act(async () => {
        removal.resolve({ ok: true })
        await Promise.all(pending)
        root.unmount()
      })
    }
  }
)
