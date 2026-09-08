import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
const root = resolve(import.meta.dirname, "../../../..")
test("the desktop renderer ships React without Solid or the legacy UI workspace", () => {
  for (const name of ["app", "desktop"]) {
    const pkg = JSON.parse(readFileSync(resolve(root, `packages/${name}/package.json`), "utf8"))
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
    expect(deps).toContain("react")
    expect(deps.some((name) => /solid|kobalte|@opencode-ai\/ui/.test(name))).toBe(false)
  }
  const entry = readFileSync(resolve(root, "packages/desktop/src/renderer/index.tsx"), "utf8")
  expect(entry).toContain("react-dom/client")
  expect(entry).not.toContain("fixture")
})
