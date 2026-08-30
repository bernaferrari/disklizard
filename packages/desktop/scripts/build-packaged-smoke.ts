#!/usr/bin/env bun
import { fileURLToPath } from "node:url"
import { packagedSmokeEnvironment } from "./packaged-smoke-environment"

/** Embed the smoke entry-point gate while producing the normal Electron bundles. */
const buildProcess = Bun.spawn([process.execPath, "run", "build"], {
  cwd: fileURLToPath(new URL("..", import.meta.url)),
  env: packagedSmokeEnvironment(process.env),
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
})

const status = await buildProcess.exited
if (status !== 0) process.exit(status)
