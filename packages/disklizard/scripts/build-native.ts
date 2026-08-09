#!/usr/bin/env bun
import { $ } from "bun"
import { chmod, mkdir } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const manifest = path.join(packageDir, "native-scanner", "Cargo.toml")
const target = Bun.env.RUST_TARGET
const windows = target ? target.includes("-windows-") : process.platform === "win32"
const binaryName = windows ? "disklizard-scanner.exe" : "disklizard-scanner"
const source = path.join(
  packageDir,
  "native-scanner",
  "target",
  ...(target ? [target] : []),
  "release",
  binaryName,
)
const destinationDir = path.resolve(packageDir, "../desktop/native")
const destination = path.join(destinationDir, binaryName)

await $`cargo build --release --manifest-path ${manifest} ${target ? ["--target", target] : []}`
await mkdir(destinationDir, { recursive: true })
await Bun.write(destination, Bun.file(source))
if (!windows) await chmod(destination, 0o755)

console.log(`[disklizard] native scanner${target ? ` (${target})` : ""}: ${destination}`)
