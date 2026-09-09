import { createRequire } from "node:module"
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { createPackage } from "@electron/asar"

// Run inside a real Electron main process: ELECTRON_RUN_AS_NODE does not
// install the ASAR wrapper, so it cannot catch this regression.
const root = await mkdtemp(path.join(tmpdir(), "disklizard-physical-fs-"))
try {
  const source = path.join(root, "source")
  await mkdir(source)
  await writeFile(path.join(source, "package.json"), '{"name":"archive-fixture"}')
  const archive = path.join(root, "fixture.asar")
  await createPackage(source, archive)
  const modulePath = path.join(root, "physical-fs.mjs")
  const built = await Bun.build({
    entrypoints: [path.resolve(import.meta.dir, "../../disklizard/src/physical-fs.ts")],
    target: "node", format: "esm",
  })
  if (!built.success) throw new Error(String(built.logs))
  await Bun.write(modulePath, built.outputs[0])
  const entry = path.join(root, "check.cjs")
  await writeFile(entry, `
const {app} = require('electron');
const assert = require('node:assert/strict');
const warnings = [];
process.on('warning', warning => warnings.push(warning));
app.whenReady().then(async () => {
  try {
    const fs = await import(${JSON.stringify(modulePath)});
    assert.equal((await fs.lstat(${JSON.stringify(archive)})).isFile(), true);
    await assert.rejects(fs.stat(${JSON.stringify(path.join(archive, "package.json"))}));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(warnings.length, 0, warnings.map(w => w.stack).join('\\n'));
    console.log('Physical ASAR file inspection passed without deprecations');
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
`)
  const electron = createRequire(import.meta.url)("electron") as string
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const child = Bun.spawn([electron, "--trace-deprecation", entry], { env, stdout: "inherit", stderr: "inherit" })
  const exitCode = await child.exited
  if (exitCode) throw new Error(`Physical filesystem regression failed (${exitCode})`)
} finally {
  await rm(root, { recursive: true, force: true })
}
