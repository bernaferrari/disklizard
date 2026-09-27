import { describe, expect, it } from "bun:test"
// TypeScript 7's package entry no longer exposes the JavaScript AST API.
import ts from "typescript-compiler"
import { DISK_LANGUAGE_PLURALS, DISK_LANGUAGE_TEXT } from "./runtime"
import { DISK_RECOGNITION_LANGUAGE_KEYS } from "./recognition-language"

const ROOT = new URL(".", import.meta.url).pathname
const VISIBLE_ATTRIBUTES = new Set([
  "alt",
  "aria-label",
  "aria-roledescription",
  "placeholder",
  "title",
])

async function productionTsxSources() {
  const files: Array<{ path: string; source: string }> = []
  for await (const name of new Bun.Glob("*.tsx").scan(ROOT)) {
    if (name === "runtime.tsx" || name.endsWith(".test.tsx")) continue
    const path = `${ROOT}${name}`
    files.push({ path, source: await Bun.file(path).text() })
  }
  return files
}

async function productionSources() {
  const files: Array<{ path: string; source: string; kind: ts.ScriptKind }> = []
  for (const pattern of ["*.ts", "*.tsx"]) {
    for await (const name of new Bun.Glob(pattern).scan(ROOT)) {
      if (
        name === "runtime.tsx" ||
        name === "recognition-language.ts" ||
        name.includes(".test.")
      )
        continue
      const path = `${ROOT}${name}`
      files.push({
        path,
        source: await Bun.file(path).text(),
        kind: name.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      })
    }
  }
  return files
}

function lineOf(file: ts.SourceFile, node: ts.Node) {
  return file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1
}

describe("Disk Utility localization boundary", () => {
  it("keeps visible JSX and toast copy behind the typed language adapter", async () => {
    const violations: string[] = []
    for (const { path, source, kind } of await productionSources()) {
      const file = ts.createSourceFile(
        path,
        source,
        ts.ScriptTarget.Latest,
        true,
        kind
      )
      const visit = (node: ts.Node, insideToast = false) => {
        const toastCall =
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === "showToast"
        const inToast = insideToast || toastCall
        if (ts.isJsxText(node) && /[A-Za-z]/.test(node.text.trim())) {
          violations.push(
            `${path}:${lineOf(file, node)} JSX text ${JSON.stringify(node.text.trim())}`
          )
        }
        if (
          ts.isJsxAttribute(node) &&
          VISIBLE_ATTRIBUTES.has(node.name.getText(file)) &&
          node.initializer &&
          ts.isStringLiteral(node.initializer) &&
          /[A-Za-z]/.test(node.initializer.text)
        ) {
          violations.push(
            `${path}:${lineOf(file, node)} ${node.name.getText(file)}=${JSON.stringify(node.initializer.text)}`
          )
        }
        if (inToast && ts.isPropertyAssignment(node)) {
          const name = node.name.getText(file).replaceAll(/["']/g, "")
          const value = node.initializer
          if (
            (name === "title" || name === "description" || name === "label") &&
            (ts.isStringLiteral(value) ||
              ts.isNoSubstitutionTemplateLiteral(value)) &&
            /[A-Za-z]/.test(value.text)
          ) {
            violations.push(
              `${path}:${lineOf(file, node)} toast ${name}=${JSON.stringify(value.text)}`
            )
          }
        }
        ts.forEachChild(node, (child) => visit(child, inToast))
      }
      visit(file)
    }
    expect(violations).toEqual([])
  })

  it("keeps every literal translation call in parity with the shipped catalogs", async () => {
    const missing: string[] = []
    for (const { path, source } of await productionTsxSources()) {
      const file = ts.createSourceFile(
        path,
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX
      )
      const visit = (node: ts.Node) => {
        if (
          ts.isCallExpression(node) &&
          node.arguments[0] &&
          ts.isStringLiteral(node.arguments[0])
        ) {
          const key = node.arguments[0].text
          const property = ts.isPropertyAccessExpression(node.expression)
            ? node.expression.name.text
            : undefined
          const direct = ts.isIdentifier(node.expression)
            ? node.expression.text
            : undefined
          if (
            (property === "t" || direct === "diskLanguageText") &&
            !(key in DISK_LANGUAGE_TEXT)
          ) {
            missing.push(`${path}:${lineOf(file, node)} ${key}`)
          }
          if (
            (property === "plural" || direct === "diskLanguagePlural") &&
            !(key in DISK_LANGUAGE_PLURALS)
          ) {
            missing.push(`${path}:${lineOf(file, node)} ${key}`)
          }
        }
        ts.forEachChild(node, visit)
      }
      visit(file)
    }
    expect(missing).toEqual([])
  })

  it("keeps every recognizer display key in the typed language catalog", () => {
    expect(
      DISK_RECOGNITION_LANGUAGE_KEYS.filter(
        (key) => !(key in DISK_LANGUAGE_TEXT)
      )
    ).toEqual([])
  })
})
