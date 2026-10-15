import { expect, test } from "bun:test"
import {
  EMPTY_FOREGROUND_PROGRESS,
  foregroundProgress,
} from "./foreground-progress"
import type { DiskScanProgress } from "./types"

function report(overrides: Partial<DiskScanProgress> = {}): DiskScanProgress {
  return {
    scanId: "scan",
    filesScanned: 4,
    size: 80,
    currentPath: "/work",
    ...overrides,
  }
}

test("late completion provenance cannot roll back displayed progress", () => {
  const started = foregroundProgress(EMPTY_FOREGROUND_PROGRESS, {
    type: "begin",
    total: 100,
  })
  const scanning = foregroundProgress(started, {
    type: "report",
    progress: report({ percent: 80 }),
  })
  const completed = foregroundProgress(scanning, { type: "complete" })
  const sourced = foregroundProgress(completed, {
    type: "report",
    progress: report({ done: true, source: "delta", size: 60, percent: 60 }),
  })
  expect(sourced.source).toBe("delta")
  expect(sourced.bytes).toBe(80)
  expect(sourced.pct).toBe(100)
  expect(scanning.pct).toBe(80)
})

test("focused expansion keeps map provenance while a replacement root starts a fresh progress snapshot", () => {
  const previous = {
    ...EMPTY_FOREGROUND_PROGRESS,
    bytes: 200,
    files: 20,
    pct: 100,
    source: "snapshot" as const,
  }
  const focused = foregroundProgress(previous, {
    type: "begin",
    total: 0,
    keepSource: true,
  })
  expect(focused).toEqual({ ...EMPTY_FOREGROUND_PROGRESS, source: "snapshot" })
  const replacement = foregroundProgress(previous, {
    type: "begin",
    total: 500,
  })
  expect(replacement).toEqual({
    ...EMPTY_FOREGROUND_PROGRESS,
    total: 500,
    source: undefined,
  })
})
