import { describe, expect, test } from "bun:test"
import {
  diagnosticRedactionTokens,
  sanitizeDiagnosticLog,
  sanitizeDiagnosticText,
  sanitizeDiagnosticValue,
  summarizeDiagnosticLogForExport,
} from "./diagnostic-sanitizer"

describe("diagnostic sanitizer", () => {
  test("redacts POSIX, Windows, UNC, relative paths, filenames, and URLs", () => {
    const secrets = [
      "/Users/alex/Projects/quiet-client/Taxes.xlsx",
      String.raw`C:\Users\Alex\Projects\quiet-client\secret-plan.txt`,
      String.raw`\\workstation\private-share\Customers\acme.csv`,
      "../../private/project/package.json",
      "customer-list.csv",
      "résumé-confidentiel.pdf",
      "projets/été/données.csv",
      ".env.local",
      "https://example.test/private?file=customer-list.csv",
      "file:///Users/alex/private.txt",
      "disklizard://scan/open?path=/Users/alex",
    ]

    for (const secret of secrets) {
      const output = sanitizeDiagnosticText(`failed to open ${secret}`)
      expect(output).not.toContain("alex")
      expect(output).not.toContain("Alex")
      expect(output).not.toContain("quiet-client")
      expect(output).not.toContain("Customers")
      expect(output).not.toContain("customer-list")
      expect(output).not.toContain("example.test")
      expect(output).not.toContain("private.txt")
      expect(output).toMatch(/\[REDACTED_(?:PATH|FILE|URL)\]/)
    }
  })

  test("preserves non-sensitive runtime and failure evidence", () => {
    expect(
      sanitizeDiagnosticValue({
        platform: "darwin",
        arch: "arm64",
        version: "0.1.0",
        electron: "42.9.3",
        errorKind: "FilesystemError",
        code: "EACCES",
        count: 42,
        packaged: true,
        absent: null,
      }),
    ).toEqual({
      platform: "darwin",
      arch: "arm64",
      version: "0.1.0",
      electron: "42.9.3",
      errorKind: "FilesystemError",
      code: "EACCES",
      count: 42,
      packaged: true,
      absent: null,
    })
  })

  test("redacts sensitive fields even when their values do not resemble paths", () => {
    expect(
      sanitizeDiagnosticValue({
        path: "secret",
        userData: "account-home",
        currentURL: "opaque-target",
        sourceId: "renderer-source",
        nested: { filenames: ["one", "two"] },
      }),
    ).toEqual({
      path: diagnosticRedactionTokens.path,
      userData: diagnosticRedactionTokens.path,
      currentURL: diagnosticRedactionTokens.url,
      sourceId: diagnosticRedactionTokens.path,
      nested: { filenames: diagnosticRedactionTokens.path },
    })
  })

  test("retains Error kind and code while sanitizing messages, stacks, and causes", () => {
    const cause = new Error(String.raw`read failed for C:\Users\Alex\private.txt`)
    const error = Object.assign(new Error("Could not scan /Users/alex/Clients/acme"), {
      name: "FilesystemError",
      code: "EACCES",
      cause,
    })
    error.stack = [
      "FilesystemError: Could not scan /Users/alex/Clients/acme",
      "    at scan (/Users/alex/disklizard/src/scanner.ts:12:4)",
      String.raw`    at run (C:\Users\Alex\disklizard\native.ts:22:2)`,
    ].join("\n")

    const output = sanitizeDiagnosticValue(error)
    const serialized = JSON.stringify(output)

    expect(output).toMatchObject({ kind: "FilesystemError", code: "EACCES" })
    expect(serialized).toContain(diagnosticRedactionTokens.path)
    expect(serialized).not.toContain("alex")
    expect(serialized).not.toContain("Alex")
    expect(serialized).not.toContain("scanner.ts")
    expect(serialized).not.toContain("native.ts")
  })

  test("bounds cycles, depth, entries, strings, getters, and binary values", () => {
    const cyclic: Record<string, unknown> = { safe: "value" }
    cyclic.self = cyclic
    const deep = { one: { two: { three: "secret" } } }
    const unreadable = {}
    Object.defineProperty(unreadable, "value", {
      enumerable: true,
      get: () => {
        throw new Error("do not invoke beyond catch")
      },
    })

    expect(sanitizeDiagnosticValue(cyclic)).toEqual({ safe: "value", self: diagnosticRedactionTokens.circular })
    expect(sanitizeDiagnosticValue(deep, { maxDepth: 2 })).toEqual({
      one: { two: diagnosticRedactionTokens.truncated },
    })
    expect(sanitizeDiagnosticValue([1, 2, 3], { maxEntries: 2 })).toEqual([1, 2, diagnosticRedactionTokens.truncated])
    expect(sanitizeDiagnosticValue("x".repeat(100), { maxStringLength: 32 })).toBe(
      `${"x".repeat(32)}${diagnosticRedactionTokens.truncated}`,
    )
    expect(sanitizeDiagnosticValue(unreadable)).toEqual({ value: "[UNREADABLE]" })
    expect(sanitizeDiagnosticValue(Buffer.alloc(17))).toBe("[BINARY 17 bytes]")

    const hostile = new Proxy(
      {},
      {
        ownKeys: () => {
          throw new Error("untrusted proxy")
        },
      },
    )
    expect(sanitizeDiagnosticValue(hostile)).toBe("[UNREADABLE]")
  })

  test("re-sanitizes and bounds local log tails", () => {
    const input = [
      "old line /Users/alex/old.txt",
      "middle line https://example.test/private",
      String.raw`new line C:\Users\Alex\new.txt`,
    ].join("\n")
    const output = sanitizeDiagnosticLog(input, 2)

    expect(output).not.toContain("old line")
    expect(output).not.toContain("example.test")
    expect(output).not.toContain("Alex")
    expect(output).toContain(diagnosticRedactionTokens.url)
    expect(output).toContain(diagnosticRedactionTokens.path)
  })

  test("exports allowlisted summaries without spaced path fragments or extensionless filenames", () => {
    const output = summarizeDiagnosticLogForExport(
      [
        "2026-08-27T12:00:00Z [error] scan failed /Users/alex/My Secret Folder/client record EACCES",
        "[warn] could not open Makefile for Project Phoenix",
        String.raw`[info] preview failed at C:\Users\Alex\Work Files\Customer Contract`,
      ].join("\n"),
    )

    expect(output).toContain('"level":"error"')
    expect(output).toContain('"codes":["EACCES"]')
    expect(output).toContain('"areas":["scan"]')
    for (const secret of [
      "alex",
      "Secret",
      "Folder",
      "client",
      "record",
      "Makefile",
      "Project",
      "Phoenix",
      "Work Files",
      "Customer Contract",
    ]) {
      expect(output).not.toContain(secret)
    }
    for (const line of output.split("\n")) expect(() => JSON.parse(line)).not.toThrow()
  })
})
