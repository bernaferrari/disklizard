import { afterEach, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DiskDeletionHistory, DELETION_HISTORY_BYTES, DELETION_HISTORY_AGE_MS, trashWithHistory } from "./disk-deletion-history"
const dirs: string[] = []
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))) })
async function fixture() { const dir = await mkdtemp(join(tmpdir(), "deletion-history-")); dirs.push(dir); return join(dir, "history.jsonl") }
const entries = async (file: string) => (await readFile(file, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))

test("records only successful Trash operations, one entry per requested directory", async () => {
  const file = await fixture(), history = new DiskDeletionHistory(file)
  await trashWithHistory("/project/build", { kind: "directory", estimatedBytes: 6000 }, async () => {}, history, () => {})
  await expect(trashWithHistory("/failed", {}, async () => { throw Error("denied") }, history, () => {})).rejects.toThrow("denied")
  expect(await entries(file)).toMatchObject([{ path: "/project/build", kind: "directory", estimatedBytes: 6000, action: "trash" }])
})
test("bounds concurrent records by count and bytes and retains newest entries", async () => {
  const file = await fixture(), history = new DiskDeletionHistory(file)
  await Promise.all(Array.from({ length: 2200 }, (_, i) => history.record("/" + "x".repeat(600) + i)))
  const rows = await entries(file)
  expect(rows.length).toBeLessThanOrEqual(2000)
  expect((await stat(file)).size).toBeLessThanOrEqual(DELETION_HISTORY_BYTES)
  expect(rows.at(-1).path.endsWith("2199")).toBe(true)
  expect(new Set(rows.map((row) => row.path)).size).toBe(rows.length)
})
test("prunes aged entries on reopening and tolerates interrupted JSON lines", async () => {
  const file = await fixture()
  await new DiskDeletionHistory(file, () => 1).record("/old")
  await new DiskDeletionHistory(file, () => DELETION_HISTORY_AGE_MS + 2).record("/new")
  expect((await entries(file)).map((row) => row.path)).toEqual(["/new"])
  await writeFile(file, (await readFile(file, "utf8")) + '{"partial":')
  await new DiskDeletionHistory(file, () => DELETION_HISTORY_AGE_MS + 3).record("/next")
  expect((await entries(file)).map((row) => row.path)).toEqual(["/new", "/next"])
})
test("an audit write error does not report an already-trashed item as failed", async () => {
  const file = await fixture(); await writeFile(file, "not a directory")
  let error: unknown
  await trashWithHistory("/done", {}, async () => {}, new DiskDeletionHistory(join(file, "history")), (e) => { error = e })
  expect(error).toBeDefined()
})

test("enforces the entry cap even when all paths are short", async () => {
  const file = await fixture(), history = new DiskDeletionHistory(file)
  await Promise.all(Array.from({ length: 2100 }, (_, i) => history.record("/" + i)))
  const rows = await entries(file)
  expect(rows.length).toBeLessThanOrEqual(2000)
  expect(rows.at(-1).path).toBe("/2099")
})
