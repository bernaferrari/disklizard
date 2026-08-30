import { describe, expect, test } from "bun:test"
import { packagedContentViolations } from "./inspect-packaged-boundary"

const requiredArchiveEntries = [
  "out/main/index.js",
  "out/main/native-parse-worker.js",
  "out/preload/index.js",
  "out/renderer/index.html",
  "out/renderer/oc-theme-preload.js",
  "out/renderer/assets/main-build.js",
]

describe("packaged standalone boundary", () => {
  test("accepts the emitted runtime and explicit native scanner only", () => {
    expect(
      packagedContentViolations({
        archiveEntries: requiredArchiveEntries,
        filesystemEntries: ["Contents/Resources/app.asar", "Contents/Resources/native/disklizard-scanner"],
        mainBundle: "import electronLog from 'electron-log'",
        preloadBundle: "const electron = require('electron')",
        rendererHtml: '<script id="oc-theme-preload-script" src="./oc-theme-preload.js"></script>',
      }),
    ).toEqual([])
  })

  test("rejects bare workspace imports and first-party source/build leakage", () => {
    const violations = packagedContentViolations({
      archiveEntries: [
        ...requiredArchiveEntries,
        "node_modules/@disklizard/app/src/disklizard.ts",
        "node_modules/@disklizard/core/native-scanner/target/release/disklizard-scanner",
        "e2e/disk-utility/main.tsx",
        "out/renderer/assets/aura-build.js",
        "out/renderer/assets/KaTeX_Main-Regular-build.woff2",
      ],
      filesystemEntries: ["resources/native/disklizard-scanner.exe"],
      mainBundle: 'import { x } from "@disklizard/app/native-i18n"',
      preloadBundle: 'require("@disklizard/core")',
      rendererHtml: '<script id="oc-theme-preload-script">inlineTheme()</script>',
    })

    expect(violations).toContain("main bundle retains a bare @disklizard/app import")
    expect(violations).toContain("preload bundle retains a bare @disklizard/core import")
    expect(violations.some((item) => item.includes("workspace copied"))).toBe(true)
    expect(violations.some((item) => item.includes("native build target"))).toBe(true)
    expect(violations.some((item) => item.includes("TypeScript source"))).toBe(true)
    expect(violations.some((item) => item.includes("self-hosted theme preload"))).toBe(true)
    expect(violations.some((item) => item.includes("one main script"))).toBe(true)
    expect(violations.some((item) => item.includes("unused KaTeX asset"))).toBe(true)
  })

  test("fails when any required emitted runtime artifact is absent", () => {
    const violations = packagedContentViolations({
      archiveEntries: [],
      filesystemEntries: [],
      mainBundle: "",
      preloadBundle: "",
      rendererHtml: "",
    })
    expect(violations).toContain("missing archive entry: out/main/native-parse-worker.js")
    expect(violations).toContain("missing packaged native scanner")
  })
})
