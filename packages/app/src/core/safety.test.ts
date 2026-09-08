import { describe, expect, it } from "bun:test"
import { canDeletePath, deletionBlockReason } from "./safety"

describe("deletion safety", () => {
  it("blocks filesystem roots, relative paths, and traversal", () => {
    expect(canDeletePath("/", "darwin")).toBe(false)
    expect(canDeletePath(".", "linux")).toBe(false)
    expect(canDeletePath("/home/alex/../etc/passwd", "linux")).toBe(false)
    expect(canDeletePath("C:\\", "win32")).toBe(false)
    expect(canDeletePath("\\\\server\\share\\", "win32")).toBe(false)
  })

  it("protects operating-system trees while leaving user data actionable", () => {
    expect(canDeletePath("/System/Library/CoreServices", "darwin")).toBe(false)
    expect(canDeletePath("//etc/passwd", "linux")).toBe(false)
    expect(canDeletePath("C:\\Windows\\System32", "win32")).toBe(false)
    expect(canDeletePath("C:\\Program Files\\Example", "win32")).toBe(false)
    expect(canDeletePath("/Applications/Example.app", "darwin")).toBe(false)
    expect(canDeletePath("/private", "darwin")).toBe(false)
    expect(canDeletePath("/private/tmp", "darwin")).toBe(false)
    expect(canDeletePath("/etc", "darwin")).toBe(false)
    expect(canDeletePath("/tmp", "darwin")).toBe(false)
    expect(canDeletePath("/bin", "linux")).toBe(false)
    expect(canDeletePath("/lost+found", "linux")).toBe(false)
    expect(canDeletePath("/tmp", "linux")).toBe(false)
    expect(canDeletePath("/var/log", "linux")).toBe(false)
    expect(canDeletePath("C:\\Users", "win32")).toBe(false)
    expect(canDeletePath("C:\\pagefile.sys", "win32")).toBe(false)
    expect(canDeletePath("C:\\System Volume Information", "win32")).toBe(false)
    expect(canDeletePath("C:\\Windows.old", "win32")).toBe(false)

    expect(canDeletePath("/Users/alex/Library/Caches/app", "darwin")).toBe(true)
    expect(canDeletePath("/home/alex/Downloads/archive.iso", "linux")).toBe(true)
    expect(canDeletePath("C:\\Users\\Alex\\Downloads\\archive.iso", "win32")).toBe(true)
  })

  it("protects the active home and every mounted volume root", () => {
    expect(deletionBlockReason("/home/alex", "linux", { homePath: "/home/alex" })).toContain("home")
    expect(deletionBlockReason("/media/Archive", "linux", { mountRoots: ["/", "/media/Archive/"] })).toContain(
      "mounted volume",
    )
  })

  it("never offers whole account profiles as deletion targets on any desktop OS", () => {
    expect(deletionBlockReason("/Users/alex", "darwin")).toContain("home directory")
    expect(deletionBlockReason("/home/alex", "linux")).toContain("home directory")
    expect(deletionBlockReason("C:\\Users\\Alex", "win32")).toContain("user profile")

    expect(canDeletePath("/Users/alex/Downloads/archive.zip", "darwin")).toBe(true)
    expect(canDeletePath("/home/alex/.cache/tool", "linux")).toBe(true)
    expect(canDeletePath("C:\\Users\\Alex\\Downloads\\archive.zip", "win32")).toBe(true)
  })

  it("rejects Windows device namespaces", () => {
    expect(canDeletePath("\\\\?\\C:\\Windows\\System32", "win32")).toBe(false)
    expect(canDeletePath("C:relative\\file.txt", "win32")).toBe(false)
  })

  it("protects coding-agent, worktree, and version-control data at every depth", () => {
    for (const path of [
      "/Users/alex/.codex/sessions",
      "/Users/alex/.claude/projects",
      "/Users/alex/project/.git/objects",
      "/Users/alex/worktrees/feature",
      "/Users/alex/.Trash/deleted-file",
    ]) {
      expect(canDeletePath(path, "darwin")).toBe(false)
    }
    expect(canDeletePath("C:\\Users\\Alex\\project\\.git\\objects", "win32")).toBe(false)
    expect(canDeletePath("C:\\$Recycle.Bin\\deleted-file", "win32")).toBe(false)
    expect(canDeletePath("/home/alex/project/node_modules", "linux")).toBe(true)
  })
})
