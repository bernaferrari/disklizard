#!/usr/bin/env bun
import { packagedSmokeEnvironment } from "./packaged-smoke-environment"
import { fileURLToPath } from "node:url"

const desktopDirectory = fileURLToPath(new URL("..", import.meta.url))

async function run(command: string[], environment: NodeJS.ProcessEnv) {
  const child = Bun.spawn(command, {
    cwd: desktopDirectory,
    env: environment,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  })
  const status = await child.exited
  if (status !== 0) process.exit(status)
}

const environment = packagedSmokeEnvironment(process.env)
await run([process.execPath, "run", "build"], environment)
await run([process.execPath, "./scripts/smoke-native-worker-bundle.ts"], environment)
await run([process.execPath, "./scripts/package-packaged-smoke.ts"], environment)
if (!process.argv.includes("--package-only")) {
  await run([process.execPath, "x", "tsx", "./scripts/run-packaged-smoke.ts"], environment)
}
