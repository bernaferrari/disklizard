import type { DiskScanNode } from "./types"
import { buildCrumbs } from "./navigation"
import { diskNodeDisplayName } from "./node-display"

/** Visual remainders reveal their real siblings; they are not folders. */
export function containingFolderForVisualGroup(
  root: DiskScanNode,
  group: DiskScanNode
): DiskScanNode | undefined {
  if (!group.isOther || !group.path.startsWith("disklizard:")) return undefined
  const first = group.children[0]
  if (!first) return undefined
  const trail = buildCrumbs(root, first)
  if (trail.at(-1)?.path !== first.path) return undefined
  const parent = trail.at(-2)?.node
  if (!parent || parent.isOther) return undefined
  const directChildren = new Set(parent.children.map((child) => child.path))
  return group.children.every((child) => directChildren.has(child.path))
    ? parent
    : undefined
}

/** Visual aggregates are browse destinations, never filesystem scan targets. */
export function createGroupNavigation() {
  const groups = new Map<
    string,
    { node: DiskScanNode; parentPath: string; root: DiskScanNode }
  >()
  function resolve(root: DiskScanNode, path: string): DiskScanNode | undefined {
    const entry = groups.get(path)
    if (!entry || entry.root.path !== root.path) return undefined
    if (entry.root === root) return entry.node
    // Keep the chosen membership stable while reconciling live sizes/deletions.
    const wanted = new Set(entry.node.children.map((child) => child.path))
    const children: DiskScanNode[] = []
    const visit = (node: DiskScanNode) => {
      if (!wanted.size) return
      if (wanted.delete(node.path)) {
        children.push(node)
        return
      }
      for (const child of node.children) visit(child)
    }
    visit(root)
    if (!children.length) {
      groups.delete(path)
      return undefined
    }
    entry.node = {
      ...entry.node,
      children,
      size: children.reduce((sum, child) => sum + child.size, 0),
      otherCount: children.length,
    }
    entry.root = root
    return entry.node
  }
  return {
    resolve,
    open(root: DiskScanNode, parent: DiskScanNode, group: DiskScanNode) {
      if (
        !group.isOther ||
        !group.children.length ||
        group.path === parent.path
      )
        return undefined
      // Use the containing folder when the clicked aggregate is several rings deep.
      const childCrumbs = buildCrumbs(root, group.children[0])
      const containing =
        childCrumbs.at(-2)?.path === group.path
          ? (childCrumbs.at(-3)?.node ?? parent)
          : (childCrumbs.at(-2)?.node ?? parent)
      const parentPath = parent.isOther ? parent.path : containing.path
      groups.set(group.path, { node: group, parentPath, root })
      if (groups.size > 64) groups.delete(groups.keys().next().value!)
      return group
    },
    crumbs(root: DiskScanNode | null, view: DiskScanNode | null) {
      if (!root || !view) return []
      const trail: DiskScanNode[] = []
      const seen = new Set<string>()
      let current = view
      while (groups.has(current.path) && !seen.has(current.path)) {
        seen.add(current.path)
        const entry = groups.get(current.path)!
        trail.unshift(current)
        const parent = groups.get(entry.parentPath)?.node
        if (parent) {
          current = parent
          continue
        }
        const chain = buildCrumbs(root, { ...root, path: entry.parentPath })
        return [
          ...chain,
          ...trail.map((node) => ({
            node,
            path: node.path,
            name: diskNodeDisplayName(node),
          })),
        ]
      }
      return buildCrumbs(root, view)
    },
  }
}
