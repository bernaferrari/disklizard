import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { RENDERER_CONTENT_SECURITY_POLICY } from "./renderer-security-policy"

describe("renderer response security", () => {
  test("ships a closed production content security policy", () => {
    expect(RENDERER_CONTENT_SECURITY_POLICY).toContain("default-src 'self'")
    expect(RENDERER_CONTENT_SECURITY_POLICY).toContain("object-src 'none'")
    expect(RENDERER_CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'")
    expect(RENDERER_CONTENT_SECURITY_POLICY).not.toContain("unsafe-eval")
    expect(RENDERER_CONTENT_SECURITY_POLICY).not.toContain("https:")
  })

  test("does not rewrite renderer traffic with wildcard CORS", () => {
    const source = readFileSync(join(import.meta.dir, "windows.ts"), "utf8")
    expect(source).not.toContain("Access-Control-Allow-Origin")
    expect(source).not.toContain("Access-Control-Allow-Headers")
  })
})
