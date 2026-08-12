import { describe, expect, it } from "bun:test"
import type { DiskScanNode } from "@/context/platform"
import {
  buildCrumbs,
  describeStorageNode,
  nativeTrashName,
  scanAccessGuidance,
  shouldHandleDiskShortcut,
} from "./navigation"

function dir(name: string, path: string, children: DiskScanNode[] = []): DiskScanNode {
  return { name, path, size: 1, isDir: true, children, ext: "" }
}

describe("buildCrumbs", () => {
  it("follows native Windows paths without mixing separators", () => {
    const target = dir("project", "C:\\Users\\alex\\project")
    const users = dir("Users", "C:\\Users", [dir("alex", "C:\\Users\\alex", [target])])
    const root = { ...dir("C:", "C:\\", [users]), _label: "Windows (C:)" }

    expect(buildCrumbs(root, target).map((crumb) => [crumb.name, crumb.path])).toEqual([
      ["Windows (C:)", "C:\\"],
      ["Users", "C:\\Users"],
      ["alex", "C:\\Users\\alex"],
      ["project", "C:\\Users\\alex\\project"],
    ])
  })

  it("supports UNC shares and returns the root when a node is not retained", () => {
    const target = dir("repo", "\\\\server\\team\\repo")
    const root = dir("team", "\\\\server\\team", [target])
    expect(buildCrumbs(root, target).map((crumb) => crumb.path)).toEqual(["\\\\server\\team", "\\\\server\\team\\repo"])
    expect(buildCrumbs(root, dir("missing", "\\\\server\\team\\missing"))).toEqual([
      { name: "team", path: "\\\\server\\team", node: root },
    ])
  })
})

describe("shouldHandleDiskShortcut", () => {
  it("leaves Enter and arrow keys to focused controls", () => {
    const button = document.createElement("button")
    const icon = document.createElement("span")
    button.append(icon)
    const editor = document.createElement("div")
    editor.setAttribute("contenteditable", "plaintext-only")
    const textbox = document.createElement("div")
    textbox.setAttribute("role", "textbox")
    const dialog = document.createElement("div")
    dialog.setAttribute("role", "dialog")
    expect(shouldHandleDiskShortcut(button, false)).toBe(false)
    expect(shouldHandleDiskShortcut(icon, false)).toBe(false)
    expect(shouldHandleDiskShortcut(document.createElement("input"), false)).toBe(false)
    expect(shouldHandleDiskShortcut(editor, false)).toBe(false)
    expect(shouldHandleDiskShortcut(textbox, false)).toBe(false)
    expect(shouldHandleDiskShortcut(dialog, false)).toBe(false)
  })

  it("handles canvas/body shortcuts unless another handler consumed them", () => {
    expect(shouldHandleDiskShortcut(document.createElement("canvas"), false)).toBe(true)
    expect(shouldHandleDiskShortcut(document.body, false)).toBe(true)
    expect(shouldHandleDiskShortcut(document.body, true)).toBe(false)
  })
})

describe("scanAccessGuidance", () => {
  it("gives an actionable instruction for every supported desktop OS", () => {
    expect(scanAccessGuidance("macos")).toContain("Full Disk Access")
    expect(scanAccessGuidance("windows")).toContain("account with access")
    expect(scanAccessGuidance("linux")).toContain("mount permissions")
  })
})

describe("nativeTrashName", () => {
  it("uses native destructive-action vocabulary on every supported desktop OS", () => {
    expect(nativeTrashName("windows")).toBe("Recycle Bin")
    expect(nativeTrashName("macos")).toBe("Trash")
    expect(nativeTrashName("linux")).toBe("Trash")
    expect(nativeTrashName()).toBe("Trash")
  })
})

describe("describeStorageNode", () => {
  it("announces size, share, and the available keyboard action", () => {
    expect(describeStorageNode(dir("target", "/repo/target"), 4)).toBe(
      "target, 1.00 B, 25% of this level. Press Enter to explore. Press C to add it to review.",
    )
    expect(describeStorageNode({ ...dir("Other", "disklizard:other"), isOther: true }, 4)).toBe(
      "Other, 1.00 B, 25% of this level.",
    )
    expect(describeStorageNode({ ...dir("main.rs", "/repo/main.rs"), isDir: false }, 4)).toBe(
      "main.rs, 1.00 B, 25% of this level. Press Space to preview. Press C to add it to review.",
    )
    expect(
      describeStorageNode(
        { ...dir("node_modules", "/repo/deep/node_modules"), inventoryOnly: true } as DiskScanNode & {
          inventoryOnly: true
        },
        4,
        { canReview: false, requiresRescanBeforeReview: true },
      ),
    ).toBe(
      "node_modules, 1.00 B, 25% of this level. Deep inventory result; it cannot be explored from the map. Rescan before adding it to review.",
    )
    expect(describeStorageNode(null, 4)).toBe("")
  })

  it("only announces shortcuts that the selected item can perform", () => {
    const hidden = { ...dir(".env", "/repo/.env"), isDir: false, isHidden: true }
    expect(describeStorageNode(hidden, 4)).toBe(".env, 1.00 B, 25% of this level. Press C to add it to review.")
    expect(describeStorageNode({ ...dir("lockfile", "/repo/lockfile"), isDir: false }, 4, { canReview: false })).toBe(
      "lockfile, 1.00 B, 25% of this level. Press Space to preview.",
    )
    expect(describeStorageNode(dir("protected", "/repo/protected"), 4, { canReview: false })).toBe(
      "protected, 1.00 B, 25% of this level. Press Enter to explore.",
    )
  })
})
