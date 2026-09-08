import { expect, test } from "bun:test"
import { act, Profiler, StrictMode } from "react"
import { createRoot } from "react-dom/client"
import DiskUtilityPage from "./index"
import { DiskLizardRuntime } from "./runtime"
import { diskUtilityFixture } from "../../fixture"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

test.each(["ready", "error"] as const)("the home screen settles while settings load and become %s", async (status) => {
  const host = document.createElement("div")
  document.body.append(host)
  const errors: unknown[] = []
  let resolveStorage!: (value: string | null) => void
  const pendingStorage = new Promise<string | null>((resolve) => { resolveStorage = resolve })
  const storage = () => ({
    getItem: () => pendingStorage,
    setItem: async () => {},
    removeItem: async () => {},
  })
  let commits = 0
  const root = createRoot(host, { onUncaughtError: (error) => errors.push(error) })
  try {
    await act(async () => {
      root.render(
        <StrictMode><Profiler id="home" onRender={() => {
          if (++commits > 60) throw new Error("Home screen render feedback loop")
        }}>
          <DiskLizardRuntime platform={{ platform: "desktop", os: "macos", diskUtility: diskUtilityFixture, storage }}>
            <DiskUtilityPage />
          </DiskLizardRuntime>
        </Profiler></StrictMode>,
      )
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    const settledCommits = commits
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)) })
    expect(commits).toBe(settledCommits)
    await act(async () => { resolveStorage(status === "ready" ? null : "invalid JSON") })
    expect(errors).toEqual([])
    expect(commits).toBeLessThan(20)
    expect(host.textContent).toContain("Test volume")
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
