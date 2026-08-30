#!/usr/bin/env bun
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { dirname, extname, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const repositoryRoot = resolve(appRoot, "../..")

const productionEntrypoints = [
  "packages/app/src/disklizard.ts",
  "packages/app/src/disklizard-i18n.ts",
  "packages/desktop/src/main/index.ts",
  "packages/desktop/src/main/env.d.ts",
  "packages/desktop/src/preload/index.ts",
  "packages/desktop/src/renderer/index.tsx",
] as const

function storageTestEntrypoints() {
  const root = resolve(repositoryRoot, "packages/app/src/pages/disk-utility")
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.test\.tsx?$/.test(entry.name))
    .map((entry) => relative(repositoryRoot, resolve(root, entry.name)))
    .sort()
}

function externalPackage(specifier: string) {
  if (specifier.startsWith("node:") || specifier.startsWith("bun:")) return specifier
  if (specifier.startsWith("@")) return specifier.split("/").slice(0, 2).join("/")
  return specifier.split("/", 1)[0]!
}

export function forbiddenDependencyReason(specifier: string, resolvedPath?: string) {
  if (specifier === "virtual:opencode-server") return "the removed OpenCode sidecar virtual module"
  const packageName = externalPackage(specifier)
  if (specifier.startsWith("@opencode-ai/") && packageName !== "@opencode-ai/ui") {
    return "an OpenCode runtime package"
  }

  const path = resolvedPath?.split(sep).join("/")
  if (!path) return undefined
  const forbiddenPath = [
    "/packages/core/",
    "/packages/llm/",
    "/packages/server/",
    "/packages/session-ui/",
    "/packages/opencode/",
    "/packages/app/src/wsl/",
    "/packages/app/src/context/server",
    "/packages/app/src/context/session",
    "/packages/app/src/utils/draft-store",
  ].find((part) => path.includes(part))
  return forbiddenPath ? `a forbidden runtime source path (${forbiddenPath})` : undefined
}

function importedSpecifiers(file: string) {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true)
  const found = new Set<string>()
  const add = (value: ts.Expression | ts.TypeNode | undefined) => {
    if (value && ts.isStringLiteralLike(value)) found.add(value.text)
  }
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) add(node.moduleSpecifier)
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) add(node.argument.literal)
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) add(node.arguments[0])
      if (ts.isIdentifier(node.expression) && node.expression.text === "require") add(node.arguments[0])
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return [...found]
}

function resolveSourceFile(specifier: string, importer: string) {
  let base: string | undefined
  if (specifier.startsWith(".")) base = resolve(dirname(importer), specifier)
  if (specifier.startsWith("@/")) base = resolve(appRoot, "src", specifier.slice(2))
  if (specifier === "@disklizard/app") base = resolve(appRoot, "src/disklizard")
  if (specifier === "@disklizard/app/choose-folder") base = resolve(appRoot, "src/pages/disk-utility/choose-folder")
  if (specifier === "@disklizard/app/i18n") base = resolve(appRoot, "src/disklizard-i18n")
  if (specifier === "@disklizard/app/native-i18n") base = resolve(appRoot, "src/i18n/desktop-native")
  if (specifier === "@disklizard/app/runtime") base = resolve(appRoot, "src/pages/disk-utility/runtime")
  if (specifier === "@disklizard/app/types") base = resolve(appRoot, "src/pages/disk-utility/types")
  if (!base) return undefined

  const candidates = extname(base)
    ? [base, base.replace(/\.js$/, ".ts"), base.replace(/\.js$/, ".tsx")]
    : [`${base}.ts`, `${base}.tsx`, `${base}.d.ts`, resolve(base, "index.ts"), resolve(base, "index.tsx")]
  return candidates.find((candidate) => existsSync(candidate))
}

export type StandaloneDependencyViolation = {
  importer: string
  specifier: string
  resolvedPath?: string
  reason: string
}

export type StandaloneDependencyReport = {
  entrypoints: string[]
  sourceFiles: string[]
  externalPackages: string[]
  forbidden: StandaloneDependencyViolation[]
}

export function analyzeStandaloneDependencyClosure(): StandaloneDependencyReport {
  const entrypoints = [...productionEntrypoints, ...storageTestEntrypoints()]
  const pending = entrypoints.map((entry) => resolve(repositoryRoot, entry))
  const visited = new Set<string>()
  const external = new Set<string>()
  const forbidden: StandaloneDependencyViolation[] = []

  while (pending.length > 0) {
    const file = pending.pop()!
    if (visited.has(file)) continue
    if (!existsSync(file))
      throw new Error(`Standalone dependency entrypoint is missing: ${relative(repositoryRoot, file)}`)
    visited.add(file)

    for (const specifier of importedSpecifiers(file)) {
      const resolvedPath = resolveSourceFile(specifier, file)
      const reason = forbiddenDependencyReason(specifier, resolvedPath)
      if (reason) {
        forbidden.push({
          importer: relative(repositoryRoot, file),
          specifier,
          resolvedPath: resolvedPath ? relative(repositoryRoot, resolvedPath) : undefined,
          reason,
        })
      }
      if (resolvedPath) pending.push(resolvedPath)
      else if (!specifier.startsWith(".")) external.add(externalPackage(specifier))
    }
  }

  return {
    entrypoints,
    sourceFiles: [...visited].map((file) => relative(repositoryRoot, file)).sort(),
    externalPackages: [...external].sort(),
    forbidden,
  }
}

export function assertStandaloneDependencyClosure() {
  const report = analyzeStandaloneDependencyClosure()
  if (report.forbidden.length > 0) {
    const detail = report.forbidden
      .map(({ importer, specifier, reason }) => `  ${importer} -> ${specifier}: ${reason}`)
      .join("\n")
    throw new Error(`DiskLizard standalone dependency seam was crossed:\n${detail}`)
  }
  return report
}

if (import.meta.main) {
  const report = assertStandaloneDependencyClosure()
  console.log(
    `[standalone] ${report.sourceFiles.length} source files across ${report.entrypoints.length} entrypoints; external packages: ${report.externalPackages.join(", ")}`,
  )
}
