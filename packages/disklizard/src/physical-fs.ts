import * as nodeFs from "node:fs"
import { createRequire } from "node:module"

// Electron's node:fs treats .asar files as virtual directories and fabricates
// Stats objects. Storage inspection must see the actual files on disk instead.
const physicalFs: typeof nodeFs = process.versions.electron && !process.env.ELECTRON_RUN_AS_NODE
  ? createRequire(import.meta.url)("original-fs")
  : nodeFs

export const { constants, existsSync, createReadStream } = physicalFs
export const { access, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, stat, writeFile } = physicalFs.promises
