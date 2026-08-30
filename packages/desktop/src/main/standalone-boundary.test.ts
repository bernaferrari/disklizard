import { describe, expect, test } from "bun:test"
import {
  analyzeStandaloneDependencyClosure,
  forbiddenDependencyReason,
} from "../../../app/scripts/check-standalone-boundary"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import ts from "typescript"

const repositoryRoot = resolve(import.meta.dirname, "../../../..")

function manifest(path: string) {
  return JSON.parse(readFileSync(resolve(repositoryRoot, path), "utf8")) as {
    name?: string
    workspaces?: { packages?: string[] }
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
    scripts?: Record<string, string>
  }
}

describe("DiskLizard standalone dependency seam", () => {
  test("production runtime and storage tests stay outside OpenCode runtime modules", () => {
    const report = analyzeStandaloneDependencyClosure()
    expect(report.entrypoints).toContain("packages/desktop/src/main/env.d.ts")
    expect(report.sourceFiles).toContain("packages/app/src/pages/disk-utility/index.tsx")
    expect(report.externalPackages).toContain("@disklizard/core")
    expect(report.externalPackages).toContain("@opencode-ai/ui")
    expect(report.externalPackages).not.toContain("@opencode-ai/core")
    expect(report.externalPackages).not.toContain("@opencode-ai/server")
    expect(report.externalPackages).not.toContain("@opencode-ai/session-ui")
    expect(report.forbidden).toEqual([])
  })

  test("recognizes package, virtual-module, and source-path violations", () => {
    expect(forbiddenDependencyReason("@opencode-ai/server")).toBeTruthy()
    expect(forbiddenDependencyReason("@opencode-ai/llm/model")).toBeTruthy()
    expect(forbiddenDependencyReason("@opencode-ai/ui/button")).toBeUndefined()
    expect(forbiddenDependencyReason("@opencode-ai/ui-runtime")).toBeTruthy()
    expect(forbiddenDependencyReason("virtual:opencode-server")).toBeTruthy()
    expect(
      forbiddenDependencyReason("../../utils/draft-store", "/repo/packages/app/src/utils/draft-store.ts"),
    ).toBeTruthy()
  })

  test("keeps the install graph on the four standalone product workspaces", () => {
    const root = manifest("package.json")
    const app = manifest("packages/app/package.json")
    const desktop = manifest("packages/desktop/package.json")
    const ui = manifest("packages/ui/package.json")
    const packageDependencies = { ...app.dependencies, ...app.devDependencies, ...desktop.dependencies }
    const desktopDependencies = { ...desktop.dependencies, ...desktop.devDependencies }
    const uiConfig = ts.readConfigFile(resolve(repositoryRoot, "packages/ui/tsconfig.json"), ts.sys.readFile)

    expect(root.workspaces?.packages).toEqual([
      "packages/app",
      "packages/desktop",
      "packages/disklizard",
      "packages/ui",
    ])
    expect(app.name).toBe("@disklizard/app")
    expect(uiConfig.error).toBeUndefined()
    expect(uiConfig.config.include).toEqual(["src"])
    expect(ui.scripts?.typecheck).toBe("tsgo --noEmit")
    expect(root.scripts?.typecheck).toContain("packages/ui typecheck")
    expect(packageDependencies).not.toHaveProperty("@opencode-ai/core")
    expect(packageDependencies).not.toHaveProperty("@opencode-ai/server")
    expect(packageDependencies).not.toHaveProperty("@opencode-ai/session-ui")
    expect(packageDependencies).not.toHaveProperty("@opencode-ai/sdk")
    expect(desktopDependencies).not.toHaveProperty("effect")
    expect(desktopDependencies).not.toHaveProperty("@sentry/solid")
    expect(desktopDependencies).not.toHaveProperty("@sentry/vite-plugin")
    expect(desktopDependencies).not.toHaveProperty("@solidjs/router")
    expect(desktopDependencies).not.toHaveProperty("@valibot/to-json-schema")
  })
})
