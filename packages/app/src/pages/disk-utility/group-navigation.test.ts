import { expect, it } from "bun:test"
import {
  createGroupNavigation,
  containingFolderForVisualGroup,
} from "./group-navigation"
import type { DiskScanNode } from "./types"
const node = (
  path: string,
  size: number,
  children: DiskScanNode[] = []
): DiskScanNode => ({
  path,
  name: path.split("/").at(-1)!,
  size,
  children,
  isDir: true,
  ext: "",
})
it("opens retained smaller items with the real containing breadcrumb and a history destination", () => {
  const a = node("/disk/folder/a", 30),
    b = node("/disk/folder/b", 20)
  const parent = node("/disk/folder", 50, [a, b]),
    root = node("/disk", 50, [parent])
  const group = {
    ...node("disklizard:orbit-more:/disk/folder", 50, [a, b]),
    isOther: true,
    otherCount: 2,
  }
  const nav = createGroupNavigation()
  expect(nav.open(root, root, group)).toBe(group)
  expect(nav.resolve(root, group.path)).toBe(group)
  expect(nav.crumbs(root, group).map((c) => c.path)).toEqual([
    root.path,
    parent.path,
    group.path,
  ])
  expect(root.children).toEqual([parent])
})
it("refreshes grouped sizes, drops removed children, and never imports new members", () => {
  const a = node("/disk/a", 30),
    b = node("/disk/b", 20),
    root = node("/disk", 50, [a, b])
  const group = {
    ...node("disklizard:orbit-more:/disk", 50, [a, b]),
    isOther: true,
  }
  const nav = createGroupNavigation()
  nav.open(root, root, group)
  const updated = node("/disk", 90, [node(a.path, 40), node("/disk/new", 50)])
  const refreshed = nav.resolve(updated, group.path)!
  expect(refreshed.size).toBe(40)
  expect(refreshed.children.map((c) => c.path)).toEqual([a.path])
  expect(nav.resolve(node("/disk", 0), group.path)).toBeUndefined()
})
it("retains nested group breadcrumbs without treating groups as filesystem paths", () => {
  const a = node("/disk/a", 30),
    root = node("/disk", 30, [a])
  const first = { ...node("disklizard:first", 30, [a]), isOther: true }
  const second = { ...node("disklizard:second", 30, [a]), isOther: true }
  const nav = createGroupNavigation()
  nav.open(root, root, first)
  nav.open(root, first, second)
  expect(nav.crumbs(root, second).map((c) => c.path)).toEqual([
    root.path,
    first.path,
    second.path,
  ])
  expect(nav.open(root, second, second)).toBeUndefined()
})
it("does not create a self-parent breadcrumb for scanner-retained groups", () => {
  const a = node("/disk/a", 10)
  const group = { ...node("/disk/other", 10, [a]), isOther: true }
  const root = node("/disk", 10, [group])
  const nav = createGroupNavigation()
  nav.open(root, root, group)
  expect(nav.crumbs(root, group).map((c) => c.path)).toEqual([
    root.path,
    group.path,
  ])
})

it("reveals a visual smaller-items group in its real containing folder", () => {
  const a = node("/disk/folder/a", 30),
    b = node("/disk/folder/b", 20)
  const folder = node("/disk/folder", 50, [a, b])
  const root = node("/disk", 50, [folder])
  const visualGroup = {
    ...node("disklizard:mosaic-more:/disk/folder/b", 20, [b]),
    isOther: true,
  }
  expect(containingFolderForVisualGroup(root, visualGroup)).toBe(folder)
  expect(containingFolderForVisualGroup(root, folder)).toBeUndefined()
  const scannerGroup = { ...node("/disk/folder/other", 20, [b]), isOther: true }
  expect(containingFolderForVisualGroup(root, scannerGroup)).toBeUndefined()
})
