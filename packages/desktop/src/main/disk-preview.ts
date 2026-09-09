import { open, stat } from "../../../disklizard/src/physical-fs"
import { basename, extname } from "node:path"

export const MAX_IMAGE_PREVIEW_BYTES = 5 * 1024 * 1024
export const MAX_PDF_PREVIEW_BYTES = 12 * 1024 * 1024
export const MAX_TEXT_PREVIEW_BYTES = 256 * 1024

export type DiskFilePreview =
  | { kind: "image"; mime: string; dataUrl: string; bytes: number }
  | { kind: "pdf"; dataUrl: string; bytes: number }
  | { kind: "text"; text: string; bytes: number; truncated: boolean }
  | { kind: "unsupported"; bytes: number; reason: "binary" | "directory" | "format" | "too-large" }

export function quickLookCommand(path: string, platform = process.platform) {
  if (platform !== "darwin") return
  return { file: "/usr/bin/qlmanage", args: ["-p", path] }
}

const IMAGE_MIMES = new Map([
  [".avif", "image/avif"],
  [".bmp", "image/bmp"],
  [".gif", "image/gif"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
])

const TEXT_EXTENSIONS = new Set([
  ".astro",
  ".bazel",
  ".bash",
  ".c",
  ".cc",
  ".cfg",
  ".clj",
  ".cmake",
  ".conf",
  ".cpp",
  ".cs",
  ".css",
  ".csv",
  ".dart",
  ".diff",
  ".env",
  ".fish",
  ".go",
  ".gradle",
  ".graphql",
  ".groovy",
  ".h",
  ".hcl",
  ".hpp",
  ".html",
  ".ini",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".kt",
  ".kts",
  ".less",
  ".lock",
  ".log",
  ".lua",
  ".md",
  ".mdx",
  ".mjs",
  ".patch",
  ".php",
  ".plist",
  ".properties",
  ".proto",
  ".ps1",
  ".py",
  ".r",
  ".rb",
  ".rs",
  ".sass",
  ".scala",
  ".scss",
  ".sh",
  ".sql",
  ".svelte",
  ".svg",
  ".swift",
  ".tf",
  ".tfvars",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".vue",
  ".xml",
  ".yaml",
  ".yml",
  ".zsh",
  ".zig",
])

const TEXT_NAMES = new Set([
  ".editorconfig",
  ".dockerignore",
  ".env",
  ".eslintignore",
  ".eslintrc",
  ".gitattributes",
  ".gitignore",
  ".npmrc",
  ".nvmrc",
  ".prettierignore",
  ".prettierrc",
  ".python-version",
  ".ruby-version",
  ".stylelintrc",
  ".tool-versions",
  "agents.md",
  "_headers",
  "_redirects",
  "build",
  "build.bazel",
  "build.gradle",
  "build.gradle.kts",
  "bun.lock",
  "changelog",
  "changelog.md",
  "claude.md",
  "cmakelists.txt",
  "codeowners",
  "dockerfile",
  "flake.lock",
  "flake.nix",
  "gemfile",
  "go.mod",
  "go.sum",
  "justfile",
  "license",
  "makefile",
  "meson.build",
  "podfile",
  "procfile",
  "readme",
  "readme.md",
])

function isTextPath(path: string) {
  const name = basename(path).toLowerCase()
  return TEXT_EXTENSIONS.has(extname(name)) || TEXT_NAMES.has(name) || name.startsWith(".env.")
}

async function readTextPreview(path: string): Promise<DiskFilePreview> {
  const handle = await open(path, "r")
  try {
    const metadata = await handle.stat()
    const bytes = metadata.size
    const wanted = Math.min(bytes, MAX_TEXT_PREVIEW_BYTES + 1)
    const buffer = Buffer.alloc(wanted)
    const result = await handle.read(buffer, 0, wanted, 0)
    const sample = buffer.subarray(0, result.bytesRead)
    if (sample.includes(0)) return { kind: "unsupported", bytes, reason: "binary" }
    const truncated = bytes > MAX_TEXT_PREVIEW_BYTES
    return {
      kind: "text",
      text: new TextDecoder().decode(sample.subarray(0, MAX_TEXT_PREVIEW_BYTES)),
      bytes,
      truncated,
    }
  } finally {
    await handle.close()
  }
}

async function readImagePreview(path: string, mime: string): Promise<DiskFilePreview> {
  return readBinaryPreview(path, mime, MAX_IMAGE_PREVIEW_BYTES, "image")
}

async function readPdfPreview(path: string): Promise<DiskFilePreview> {
  return readBinaryPreview(path, "application/pdf", MAX_PDF_PREVIEW_BYTES, "pdf")
}

async function readBinaryPreview(
  path: string,
  mime: string,
  maxBytes: number,
  kind: "image" | "pdf",
): Promise<DiskFilePreview> {
  const handle = await open(path, "r")
  try {
    const metadata = await handle.stat()
    if (!metadata.isFile()) return { kind: "unsupported", bytes: metadata.size, reason: "directory" }
    if (metadata.size > maxBytes) {
      return { kind: "unsupported", bytes: metadata.size, reason: "too-large" }
    }
    const buffer = Buffer.alloc(metadata.size)
    const result = await handle.read(buffer, 0, metadata.size, 0)
    const dataUrl = `data:${mime};base64,${buffer.subarray(0, result.bytesRead).toString("base64")}`
    if (kind === "pdf") return { kind, dataUrl, bytes: result.bytesRead }
    return {
      kind,
      mime,
      dataUrl,
      bytes: result.bytesRead,
    }
  } finally {
    await handle.close()
  }
}

export async function readDiskPreview(path: string): Promise<DiskFilePreview> {
  const metadata = await stat(path)
  if (!metadata.isFile()) return { kind: "unsupported", bytes: metadata.size, reason: "directory" }

  const extension = extname(path).toLowerCase()
  const imageMime = IMAGE_MIMES.get(extension)
  if (imageMime) return readImagePreview(path, imageMime)
  if (extension === ".pdf") return readPdfPreview(path)

  if (isTextPath(path)) return readTextPreview(path)
  return { kind: "unsupported", bytes: metadata.size, reason: "format" }
}
