import { expect, test } from "bun:test"
import { consolidateHistoryChanges } from "./history-presentation"
import type { ScanHistoryEntry } from "./scan-history"
const entry = (time: number, before: number, after: number): ScanHistoryEntry => ({
  id: String(time), scanId: "scan", rootPath: "/", recordedAt: time, changedPaths: ["/cache"], totalDeltaBytes: after-before,
  changes: [{path:"/cache", name:"cache", kind:"changed", beforeBytes:before, afterBytes:after, deltaBytes:after-before, isDir:true}],
})
test("consolidates repeated updates using observed deltas rather than filling unobserved gaps", () => {
  const rows = consolidateHistoryChanges([entry(2, 30, 35), entry(1, 10, 12)])
  expect(rows).toHaveLength(1)
  expect(rows[0].deltaBytes).toBe(7)
  expect(rows[0].recordedAt).toBe(2)
})
