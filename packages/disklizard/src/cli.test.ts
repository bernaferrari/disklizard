import { describe, expect, test } from "bun:test"
import { diskLizardCliHelp, formatDiskLizardJson, formatDiskLizardSummary, parseDiskLizardCliArgs } from "./cli"

describe("DiskLizard CLI", () => {
  test("parses agent-friendly read-only output options", () => {
    expect(parseDiskLizardCliArgs(["/work", "--json", "--logical", "--max-depth", "6"])).toEqual({
      path: "/work",
      format: "json",
      maxDepth: 6,
      sizeMode: "logical",
    })
  })

  test("keeps the default interactive browser and rejects ambiguous input", () => {
    expect(parseDiskLizardCliArgs([])).toMatchObject({ format: "tui", maxDepth: 10, sizeMode: "physical" })
    expect(() => parseDiskLizardCliArgs(["/one", "/two"])).toThrow("Specify only one scan path")
  })

  test("formats a compact, non-destructive summary", () => {
    expect(
      formatDiskLizardSummary(
        {
          name: "work",
          path: "/work",
          size: 2048,
          isDir: true,
          ext: "",
          children: [{ name: "node_modules", path: "/work/node_modules", size: 1024, isDir: true, ext: "", children: [] }],
        },
        "physical",
      ),
    ).toContain("node_modules")
  })

  test("describes every CLI mode as read-only", () => {
    expect(diskLizardCliHelp()).toContain("read-only in every mode")
    expect(diskLizardCliHelp()).not.toContain("permanent deletion")
  })

  test("JSON output reports backend, accounting, and evidence from the real scan result", () => {
    const payload = formatDiskLizardJson({
      backend: "native",
      accounting: "physical",
      evidence: "complete",
      root: {
        name: "work",
        path: "/work",
        size: 2048,
        isDir: true,
        ext: "",
        children: [],
        sharedStorageEvidence: "complete",
      },
    })
    expect(payload).toMatchObject({ backend: "native", accounting: "physical", evidence: "complete" })
    expect(payload.root.path).toBe("/work")
    expect(payload.root.size).toBe(2048)
  })
})
