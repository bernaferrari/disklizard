#!/usr/bin/env bun

const version = process.env.DISKLIZARD_VERSION
if (!version) throw new Error("DISKLIZARD_VERSION is required")

const pkg = await Bun.file("./package.json").json()
pkg.version = version
await Bun.write("./package.json", JSON.stringify(pkg, null, 2) + "\n")
console.log(`Updated package.json version to ${version}`)
