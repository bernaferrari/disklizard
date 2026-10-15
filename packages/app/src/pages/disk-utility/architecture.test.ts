import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import ts from "typescript-compiler"

function imports(name: string) {
  const source = readFileSync(new URL(`./${name}`, import.meta.url), "utf8")
  const file = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true)
  return file.statements.filter(ts.isImportDeclaration).map((statement) => ({
    path: (statement.moduleSpecifier as ts.StringLiteral).text,
    typeOnly:
      statement.importClause?.isTypeOnly === true ||
      (statement.importClause?.namedBindings &&
        ts.isNamedImports(statement.importClause.namedBindings) &&
        statement.importClause.namedBindings.elements.every(
          (element) => element.isTypeOnly
        )),
  }))
}

test("scan state and request kernels do not import React or presentation modules", () => {
  for (const name of [
    "scan-workspace.ts",
    "foreground-progress.ts",
    "foreground-scans.ts",
    "background-scans.ts",
    "scan-jobs.ts",
  ]) {
    for (const dependency of imports(name)) {
      expect(dependency.path, `${name} -> ${dependency.path}`).not.toMatch(
        /react|Disk.*(?:View|Surfaces)|use-disk-utility-workspace/
      )
    }
  }
})

test("presentation contracts do not depend on the workspace coordinator's inferred return type", () => {
  for (const name of [
    "DiskUtilityView.tsx",
    "DiskWorkspaceHeader.tsx",
    "DiskWorkspaceOverview.tsx",
    "DiskWorkspaceDialogs.tsx",
    "DiskProtectionNotice.tsx",
    "DiskCleanupWorkspace.tsx",
    "DiskLandscape.tsx",
    "DiskIndexPanel.tsx",
  ]) {
    for (const dependency of imports(name)) {
      expect(dependency.path, `${name} -> ${dependency.path}`).not.toBe(
        "./use-disk-utility-workspace"
      )
      if (dependency.path.startsWith("./use-"))
        expect(dependency.typeOnly, `${name} -> ${dependency.path}`).toBe(true)
    }
  }
})
