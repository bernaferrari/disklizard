import { expect, test } from "bun:test"
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

test("bundled scanner resolution survives the desktop changing cwd to home", async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), "disklizard-resolution-"))
  try {
    const desktop = path.join(temporary, "desktop")
    const binary = path.join(desktop, "native", process.platform === "win32" ? "disklizard-scanner.exe" : "disklizard-scanner")
    await mkdir(path.dirname(binary), { recursive: true })
    await writeFile(binary, "fixture")
    const source = path.resolve(import.meta.dir, "../../../disklizard/src/native.ts")
    const entry = path.join(temporary, "probe.ts")
    await writeFile(entry, `import {nativeScannerPath} from ${JSON.stringify(source)}; console.log(nativeScannerPath())`)
    const outdir = path.join(desktop, "out/main")
    const build = await Bun.build({ entrypoints: [entry], outdir, target: "node" })
    expect(build.success).toBe(true)
    const env = { ...process.env }
    delete env.DISKLIZARD_SCANNER_PATH
    const child = Bun.spawn([process.execPath, path.join(outdir, "probe.js")], {
      cwd: temporary, env, stdout: "pipe", stderr: "pipe",
    })
    const output = await new Response(child.stdout).text()
    expect(await child.exited).toBe(0)
    expect(await realpath(output.trim())).toBe(await realpath(binary))
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})
