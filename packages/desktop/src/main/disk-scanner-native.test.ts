import { afterEach, beforeAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { scanPathSync } from "../../../disklizard/src/scan"
import { parseNativeMessage, scanPathNative } from "./disk-scanner-native"

const roots: string[] = []

beforeAll(() => {
  const binary = process.platform === "win32" ? "disklizard-scanner.exe" : "disklizard-scanner"
  process.env.DISKLIZARD_SCANNER_PATH = path.resolve(import.meta.dir, "../../native", binary)
})

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "disklizard-native-"))
  roots.push(root)
  await mkdir(path.join(root, "project", "node_modules"), { recursive: true })
  await Promise.all([
    writeFile(path.join(root, "project", "app.ts"), new Uint8Array(17)),
    writeFile(path.join(root, "project", "node_modules", "package.js"), new Uint8Array(31)),
    writeFile(path.join(root, "readme.md"), new Uint8Array(7)),
  ])
  return root
}

describe("native disk scanner", () => {
  test("matches the TypeScript scanner's logical byte accounting", async () => {
    const root = await fixture()
    const options = {
      maxDepth: 10,
      maxChildren: 48,
      sizeMode: "logical" as const,
      collapseNames: ["node_modules"],
      signatureNames: ["package.json"],
    }
    const [native, typescript] = await Promise.all([scanPathNative(root, options), scanPathSync(root, options)])

    expect(native.size).toBe(typescript.size)
    expect(native.size).toBe(55)
    expect(native.children.map((child) => child.name)).toEqual(typescript.children.map((child) => child.name))
  })

  test("terminates the sidecar when a scan is cancelled", async () => {
    const root = await fixture()
    const controller = new AbortController()
    const result = scanPathNative(root, {
      sizeMode: "logical",
      signal: controller.signal,
      onProgress: () => controller.abort(new Error("cancelled in test")),
    })

    const cancellation = await result.then(
      () => "resolved",
      (error) => (error instanceof Error ? error.message : String(error)),
    )
    expect(cancellation).toBe("cancelled in test")
  })

  test("rejects malformed protocol messages", () => {
    expect(parseNativeMessage("not-json")).toBeUndefined()
    expect(parseNativeMessage('{"type":"progress","progress":{}}')).toBeUndefined()
  })

  test("hydrates compact protocol trees without repeated path prefixes on the wire", () => {
    const message = parseNativeMessage(
      JSON.stringify({
        type: "done",
        protocol: 2,
        rootPath: "/workspace",
        root: {
          n: "workspace",
          s: 12,
          d: true,
          c: [
            { n: "index.ts", s: 4, m: 123 },
            { n: "target", s: 8, d: true, x: true, g: ["debug"] },
            { n: "Other (2 items)", s: 0, d: true, o: true },
          ],
        },
      }),
    )

    expect(message?.type).toBe("done")
    if (message?.type !== "done") throw new Error("expected compact tree")
    expect(message.root.path).toBe("/workspace")
    expect(message.root.children[0]).toMatchObject({
      path: path.join("/workspace", "index.ts"),
      ext: "ts",
      modifiedAt: 123,
    })
    expect(message.root.children[1]).toMatchObject({
      path: path.join("/workspace", "target"),
      isCollapsed: true,
      signatures: ["debug"],
    })
    expect(message.root.children[2].path).toBe(path.join("/workspace", "__other__"))
  })
})
