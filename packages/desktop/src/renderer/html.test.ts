import { describe, expect, test } from "bun:test"
import { join, dirname, resolve } from "node:path"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { diskLizardPublicDir, resolveDiskLizardViteChannel } from "@disklizard/app/vite"

const dir = dirname(fileURLToPath(import.meta.url))
const root = resolve(dir, "../..")

const html = async (name: string) => Bun.file(join(dir, name)).text()

/**
 * Packaged Electron windows load renderer HTML via the privileged `oc://`
 * protocol. Root-relative asset paths like `src="/foo.js"` would resolve from
 * the protocol origin root instead of relative to the current HTML entrypoint.
 *
 * All local resource references must use relative paths (`./`).
 */
describe("electron renderer html", () => {
  for (const name of ["index.html"]) {
    describe(name, () => {
      test("uses the DiskLizard window title", async () => {
        expect(await html(name)).toContain("<title>DiskLizard</title>")
      })

      test("script src attributes use relative paths", async () => {
        const content = await html(name)
        const srcs = [...content.matchAll(/\bsrc=["']([^"']+)["']/g)].map((m) => m[1])
        for (const src of srcs) {
          expect(src).not.toMatch(/^\/[^/]/)
        }
      })

      test("keeps the theme preload external so the packaged CSP permits it", async () => {
        const content = await html(name)
        expect(content).toContain('<script id="oc-theme-preload-script" src="./oc-theme-preload.js"></script>')
        const config = await Bun.file(join(root, "electron.vite.config.ts")).text()
        expect(config).not.toContain("diskLizardThemePreload")
        expect(config).not.toContain("transformIndexHtml")
      })

      test("link href attributes use relative paths", async () => {
        const content = await html(name)
        const hrefs = [...content.matchAll(/<link[^>]+href=["']([^"']+)["']/g)].map((m) => m[1])
        for (const href of hrefs) {
          expect(href).not.toMatch(/^\/[^/]/)
        }
      })

      test("no web manifest link (not applicable in Electron)", async () => {
        const content = await html(name)
        expect(content).not.toContain('rel="manifest"')
        expect(content).not.toContain("social-share")
        expect(content).not.toContain("favicon")
      })
    })
  }
})

/**
 * The renderer config consumes this path through the standalone app package
 * interface, so the package owns both the asset and its location.
 */
describe("electron vite publicDir", () => {
  test("configured publicDir resolves to a directory with oc-theme-preload.js", async () => {
    const config = await Bun.file(join(root, "electron.vite.config.ts")).text()
    expect(config).toContain("publicDir: diskLizardPublicDir")
    expect(existsSync(diskLizardPublicDir)).toBe(true)
    expect(existsSync(join(diskLizardPublicDir, "oc-theme-preload.js"))).toBe(true)
    expect(readdirSync(diskLizardPublicDir).sort()).toEqual(["oc-theme-preload.js"])
    const preload = readFileSync(join(diskLizardPublicDir, "oc-theme-preload.js"), "utf8")
    expect(preload).toContain('dataset.theme = "oc-2"')
    expect(preload).not.toContain("localStorage")
  })

  test("does not turn a legacy feed name into a production build identity", () => {
    expect(resolveDiskLizardViteChannel(undefined, "latest")).toBe("dev")
    expect(resolveDiskLizardViteChannel("beta", "latest")).toBe("beta")
  })
})
