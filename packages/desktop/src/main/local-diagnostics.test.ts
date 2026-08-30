import { describe, expect, test } from "bun:test"
import {
  createLocalDiagnosticExport,
  createLocalDiagnosticExportAsync,
  createLocalDiagnosticManifest,
  isCurrentRunDiagnosticLog,
  LOCAL_DIAGNOSTIC_EXPORT_POLICY,
  type LocalDiagnosticManifestInput,
} from "./local-diagnostics"

const now = new Date("2026-08-27T12:00:00.000Z").getTime()

const manifestInput: LocalDiagnosticManifestInput = {
  generatedAt: "2026-08-27T12:00:00.000Z",
  name: "DiskLizard",
  version: "0.1.0",
  packaged: true,
  platform: "darwin",
  arch: "arm64",
  electronVersion: "42.9.3",
  chromeVersion: "142.0.7444.134",
  nodeVersion: "24.11.1",
  uptimeSeconds: 13.7,
  logFiles: 99,
}

describe("local diagnostic export policy", () => {
  test("disables raw crash collection and keeps export opt-in and local-only", () => {
    expect(LOCAL_DIAGNOSTIC_EXPORT_POLICY).toEqual({
      initiatedBy: "explicit-user-action",
      destination: "local-file",
      automaticUpload: false,
      rawCrashCollection: false,
      sanitized: true,
      contents: {
        currentRunApplicationLogSummaries: true,
        rawApplicationLogText: false,
        previousRunLogs: false,
        networkLogs: false,
        crashDumps: false,
        inheritedServerLogs: false,
        heapSnapshots: false,
      },
    })
  })

  test("manifest includes useful runtime evidence but no local directories", () => {
    const output = createLocalDiagnosticManifest(manifestInput)
    const serialized = JSON.stringify(output)

    expect(output).toMatchObject({
      schemaVersion: 1,
      privacy: LOCAL_DIAGNOSTIC_EXPORT_POLICY,
      application: { name: "DiskLizard", version: "0.1.0", packaged: true },
      runtime: {
        platform: "darwin",
        arch: "arm64",
        versions: { electron: "42.9.3", chrome: "142.0.7444.134", node: "24.11.1" },
        uptimeSeconds: 14,
      },
    })
    expect(serialized).not.toMatch(/"userData"\s*:|\/Users\/|[A-Z]:\\\\|\.local\/share/i)
  })

  test("accepts only recent, bounded, flat application log files", () => {
    const candidate = { name: "main.log", isFile: true, size: 1024, modifiedAt: now }

    expect(isCurrentRunDiagnosticLog(candidate, now)).toBe(true)
    expect(isCurrentRunDiagnosticLog({ ...candidate, name: "network.netlog" }, now)).toBe(false)
    expect(isCurrentRunDiagnosticLog({ ...candidate, name: "crash.dmp" }, now)).toBe(false)
    expect(isCurrentRunDiagnosticLog({ ...candidate, name: "memory.heapsnapshot" }, now)).toBe(false)
    expect(isCurrentRunDiagnosticLog({ ...candidate, name: "../server.log" }, now)).toBe(false)
    expect(isCurrentRunDiagnosticLog({ ...candidate, isFile: false }, now)).toBe(false)
    expect(isCurrentRunDiagnosticLog({ ...candidate, size: 5 * 1024 * 1024 + 1 }, now)).toBe(false)
    expect(isCurrentRunDiagnosticLog({ ...candidate, modifiedAt: now - 24 * 60 * 60 * 1000 - 1 }, now)).toBe(false)
  })

  test("builds a sanitized archive with generic names and no raw attachments", () => {
    const entries = createLocalDiagnosticExport(
      manifestInput,
      [
        {
          name: "main.log",
          isFile: true,
          size: 128,
          modifiedAt: now,
          contents:
            "scan failed at /Users/alex/My Secret Folder/client record Makefile https://example.test/private",
        },
        {
          name: "network.netlog",
          isFile: true,
          size: 128,
          modifiedAt: now,
          contents: "https://should-never-be-included.test/private",
        },
        {
          name: "crash.dmp",
          isFile: true,
          size: 128,
          modifiedAt: now,
          contents: "raw crash dump",
        },
        {
          name: "opencode-server.log",
          isFile: true,
          size: 128,
          modifiedAt: now - 25 * 60 * 60 * 1000,
          contents: "/Users/alex/.local/share/opencode/log",
        },
      ],
      now,
    )
    const serialized = JSON.stringify(entries)

    expect(entries.map((entry) => entry.name)).toEqual(["manifest.json", "logs/log-01.jsonl"])
    expect(JSON.parse(entries[0].contents)).toMatchObject({ logFiles: 1 })
    expect(serialized).not.toContain("main.log")
    expect(serialized).not.toContain("network.netlog")
    expect(serialized).not.toContain("crash.dmp")
    expect(serialized).not.toContain("opencode")
    expect(serialized).not.toContain("alex")
    expect(serialized).not.toContain("Secret Folder")
    expect(serialized).not.toContain("client record")
    expect(serialized).not.toContain("Makefile")
    expect(serialized).not.toContain("example.test")
  })

  test("yields between bounded log summaries in the main-process export path", async () => {
    let yields = 0
    const candidate = {
      name: "main.log",
      isFile: true,
      size: 64,
      modifiedAt: now,
      contents: "[error] scan failed /Users/alex/private.txt EACCES",
    }
    const entries = await createLocalDiagnosticExportAsync(manifestInput, [candidate, { ...candidate, name: "renderer.log" }], now, async () => {
      yields += 1
    })

    expect(yields).toBe(2)
    expect(entries.map((entry) => entry.name)).toEqual([
      "manifest.json",
      "logs/log-01.jsonl",
      "logs/log-02.jsonl",
    ])
    expect(JSON.stringify(entries)).not.toContain("alex")
  })
})
