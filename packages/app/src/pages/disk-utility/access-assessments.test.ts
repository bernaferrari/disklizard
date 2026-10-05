import { expect, test } from "bun:test"
import { createAccessAssessments } from "./access-assessments"
import type { DiskPathAccess, DiskScanNode } from "./types"
const node = (path: string, size = 1): DiskScanNode => ({
  name: path,
  path,
  size,
  isDir: true,
  ext: "",
  children: [],
})
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

test("assessments retain denials and distinguish unchecked, pending, unknown and read-only", async () => {
  const store = createAccessAssessments(async (path) => ({
    state: path === "/a" ? "denied" : path === "/b" ? "read-only" : "unknown",
  }))
  const a = node("/a"),
    b = node("/b"),
    c = node("/c")
  expect(store.get(a).state).toBe("not-checked")
  store.request(a)
  expect(store.get(a).state).toBe("checking")
  await settle()
  store.request(b)
  await settle()
  expect(store.get(a).state).toBe("denied")
  expect(store.get(b).state).toBe("read-only")
  store.request(c)
  await settle()
  expect(store.get(c).state).toBe("unknown")
  expect(store.get(node("/a", 2)).state).toBe("not-checked")
})

test("requests have bounded concurrency and stale identity responses cannot overwrite a retry", async () => {
  const pending: Array<{
    path: string
    resolve: (value: DiskPathAccess) => void
  }> = []
  const store = createAccessAssessments(
    (path) => new Promise((resolve) => pending.push({ path, resolve })),
    2
  )
  const a = node("/a")
  store.request(a)
  store.request(node("/b"))
  store.request(node("/c"))
  await settle()
  expect(pending.map((job) => job.path)).toEqual(["/a", "/b"])
  store.request(node("/a", 2))
  pending[0].resolve({ state: "denied" })
  await settle()
  expect(store.get(node("/a", 2)).state).toBe("checking")
  pending[1].resolve({ state: "likely" })
  pending[2].resolve({ state: "likely" })
  await settle()
  pending[3].resolve({ state: "denied" })
  await settle()
  expect(store.get(node("/a", 2)).state).toBe("denied")
  store.request(node("/a", 2), true)
  expect(store.get(node("/a", 2)).previousState).toBe("denied")
  await settle()
  pending[4].resolve({ state: "likely" })
  await settle()
  expect(store.get(node("/a", 2)).state).toBe("likely")
})
