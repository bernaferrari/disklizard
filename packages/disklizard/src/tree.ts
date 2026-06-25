import type { Crumb, DiskNode } from "./types"

export function buildCrumbs(root: DiskNode | null, current: DiskNode | null): Crumb[] {
  if (!root || !current) return []
  const chain: Crumb[] = []

  function walk(node: DiskNode, acc: Crumb[]): boolean {
    const next: Crumb[] = [
      ...acc,
      { name: node === root ? node._label || node.name : node.name, path: node.path, node },
    ]
    if (node.path === current!.path) {
      chain.push(...next)
      return true
    }
    for (const child of node.children ?? []) {
      if (walk(child, next)) return true
    }
    return false
  }

  walk(root, [])
  if (!chain.length) chain.push({ name: root._label || root.name, path: root.path, node: root })
  return chain
}

export function findParent(root: DiskNode, targetPath: string): DiskNode | null {
  for (const child of root.children ?? []) {
    if (child.path === targetPath) return root
    const found = findParent(child, targetPath)
    if (found) return found
  }
  return null
}

export function findNode(root: DiskNode, targetPath: string): DiskNode | null {
  if (root.path === targetPath) return root
  for (const child of root.children ?? []) {
    const found = findNode(child, targetPath)
    if (found) return found
  }
  return null
}

export function sortedChildren(node: DiskNode): DiskNode[] {
  return [...(node.children ?? [])].sort((a, b) => b.size - a.size)
}

export function canDrill(node: DiskNode): boolean {
  return !!(node.isDir && node.children?.length && !node.isOther)
}
