#!/usr/bin/env bun
import { createRequire } from "node:module"
import path from "node:path"

const require = createRequire(import.meta.url)
const electron: unknown = require("electron")
if (typeof electron !== "string" || electron.length === 0) throw new Error("Electron executable is unavailable")

const smoke = path.resolve(import.meta.dir, "smoke-native-worker-bundle.mjs")
const child = Bun.spawn([electron, smoke], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  stdin: "ignore",
  stdout: "inherit",
  stderr: "inherit",
})
const code = await child.exited
if (code !== 0) process.exit(code)
