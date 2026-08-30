#!/usr/bin/env bun
import { resolveDesktopChannel } from "../src/main/product-identity"
import { fileURLToPath } from "node:url"

const desktopDirectory = fileURLToPath(new URL("..", import.meta.url))

/** Freeze one channel identity for both Vite compilation and electron-builder. */
export function packageEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const environment = { ...source }
  const channel = resolveDesktopChannel(environment.DISKLIZARD_CHANNEL, environment.OPENCODE_CHANNEL)
  environment.DISKLIZARD_CHANNEL = channel
  environment.OPENCODE_CHANNEL = channel
  return environment
}

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

if (import.meta.main) {
  const environment = packageEnvironment(process.env)
  await run([process.execPath, "run", "build"], environment)
  await run(
    [process.execPath, "x", "electron-builder", ...process.argv.slice(2), "--config", "electron-builder.config.ts"],
    environment,
  )
}
