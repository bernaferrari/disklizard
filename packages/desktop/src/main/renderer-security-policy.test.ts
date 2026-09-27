import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  RENDERER_CONTENT_SECURITY_POLICY,
  RENDERER_DEV_CONTENT_SECURITY_POLICY,
  rendererContentSecurityPolicy,
} from "./renderer-security-policy"

const reactRefreshPreamble = `import { injectIntoGlobalHook } from "/@react-refresh";
injectIntoGlobalHook(window);
window.$RefreshReg$ = () => {};
window.$RefreshSig$ = () => (type) => type;`

describe("renderer response security", () => {
  test("ships a closed production content security policy", () => {
    expect(RENDERER_CONTENT_SECURITY_POLICY).toContain("default-src 'self'")
    expect(RENDERER_CONTENT_SECURITY_POLICY).toContain("script-src 'self'")
    expect(RENDERER_CONTENT_SECURITY_POLICY).not.toContain("script-src 'self' 'unsafe-inline'")
    expect(RENDERER_CONTENT_SECURITY_POLICY).toContain("object-src 'none'")
    expect(RENDERER_CONTENT_SECURITY_POLICY).toContain("frame-src data:")
    expect(RENDERER_CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'")
    expect(RENDERER_CONTENT_SECURITY_POLICY).not.toContain("unsafe-eval")
    expect(RENDERER_CONTENT_SECURITY_POLICY).not.toContain("https:")
    expect(rendererContentSecurityPolicy(false)).toBe(RENDERER_CONTENT_SECURITY_POLICY)
  })

  test("lets the Vite dev server run its inline React refresh preamble", () => {
    expect(RENDERER_DEV_CONTENT_SECURITY_POLICY).toContain("script-src 'self' 'unsafe-inline'")
    expect(RENDERER_DEV_CONTENT_SECURITY_POLICY).not.toContain("unsafe-eval")
    expect(RENDERER_DEV_CONTENT_SECURITY_POLICY).not.toContain("https:")
    expect(rendererContentSecurityPolicy(true)).toBe(RENDERER_DEV_CONTENT_SECURITY_POLICY)
    expect(reactRefreshPreamble).toContain("injectIntoGlobalHook")
    expect(rendererContentSecurityPolicy(false).includes("script-src 'self' 'unsafe-inline'")).toBe(false)
  })

  test("does not rewrite renderer traffic with wildcard CORS", () => {
    const source = readFileSync(join(import.meta.dir, "windows.ts"), "utf8")
    expect(source).not.toContain("Access-Control-Allow-Origin")
    expect(source).not.toContain("Access-Control-Allow-Headers")
    expect(source).not.toContain("include-js-call-stacks-in-crash-reports")
  })
})
