import { expect, test } from "bun:test"
import { traversalWorkWeights } from "./work-progress"

test("skipped entries and direct files cannot complete pending subtrees", () => {
  expect(traversalWorkWeights(["skip", "skip", "skip", "file", "directory", "directory"] as const, (kind) => kind))
    .toEqual([0, 0, 0, 0, 0.5, 0.5])
})
test("file-only directories divide work among eligible files", () => {
  expect(traversalWorkWeights(["skip", "file", "file"] as const, (kind) => kind)).toEqual([0, 0.5, 0.5])
  expect(traversalWorkWeights(["skip"] as const, (kind) => kind)).toEqual([0])
  expect(traversalWorkWeights([], () => "skip")).toEqual([])
})
