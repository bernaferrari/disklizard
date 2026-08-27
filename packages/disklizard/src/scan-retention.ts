import { sep } from "node:path"
import type { DiskNode } from "./types"

const OTHER_SAMPLE_LIMIT = 12

export function apparentBytes(node: Pick<DiskNode, "size" | "logicalSize">): number {
  return node.logicalSize ?? node.size
}

export function compareNodesBySize(left: DiskNode, right: DiskNode): number {
  if (left.size !== right.size) return right.size - left.size
  // JavaScript's string order is UTF-16 code-unit order. Keeping it explicit
  // makes top-K retention and Other samples stable across traversal timing.
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0
}

function insertBounded(nodes: DiskNode[], node: DiskNode, limit: number): DiskNode | undefined {
  let low = 0
  let high = nodes.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (compareNodesBySize(node, nodes[middle]) < 0) high = middle
    else low = middle + 1
  }
  nodes.splice(low, 0, node)
  return nodes.length > limit ? nodes.pop() : undefined
}

function containsPreservedNode(node: DiskNode, preserveNames: ReadonlySet<string>): boolean {
  if (preserveNames.has(node.name.toLowerCase())) return true
  for (const child of node.children) if (containsPreservedNode(child, preserveNames)) return true
  return false
}

function joinChildPath(parent: string, name: string): string {
  if (!parent) return name
  const last = parent.charCodeAt(parent.length - 1)
  if (last === 47 /* / */ || last === 92 /* \\ */) return parent + name
  return parent + sep + name
}

export type RetainedChildren = {
  children: DiskNode[]
  size: number
  logicalSize?: number
  modifiedAt?: number
}

/**
 * Retains a deterministic top-K tree while preserving named artifact ancestry
 * and accounting for every accepted child in one compact `Other` node.
 */
export class ChildRetention {
  private readonly top: DiskNode[] = []
  private readonly preservedOverflow: DiskNode[] = []
  private readonly restSample: DiskNode[] = []
  private restCount = 0
  private restSize = 0
  private restLogicalSize = 0
  private restModifiedAt = 0
  private totalSize = 0
  private totalLogicalSize = 0
  private modifiedAt = 0

  constructor(
    private readonly parentPath: string,
    private readonly limit: number,
    private readonly preserveNames: ReadonlySet<string>,
  ) {}

  add(child: DiskNode | null): void {
    if (!child || (child.size <= 0 && child.children.length === 0 && !child.hardLink)) return
    this.totalSize += child.size
    this.totalLogicalSize += apparentBytes(child)
    this.modifiedAt = Math.max(this.modifiedAt, child.modifiedAt ?? 0)

    const overflow = insertBounded(this.top, child, this.limit)
    if (!overflow) return
    if (containsPreservedNode(overflow, this.preserveNames)) {
      this.preservedOverflow.push(overflow)
      return
    }

    this.restCount++
    this.restSize += overflow.size
    this.restLogicalSize += apparentBytes(overflow)
    this.restModifiedAt = Math.max(this.restModifiedAt, overflow.modifiedAt ?? 0)
    insertBounded(this.restSample, overflow, OTHER_SAMPLE_LIMIT)
  }

  finish(): RetainedChildren {
    this.preservedOverflow.sort(compareNodesBySize)
    const children = this.preservedOverflow.length ? [...this.top, ...this.preservedOverflow] : this.top
    if (this.restSize > 0) {
      children.push({
        name: `Other (${this.restCount} ${this.restCount === 1 ? "item" : "items"})`,
        path: joinChildPath(this.parentPath, "__other__"),
        size: this.restSize,
        ...(this.restLogicalSize === this.restSize ? {} : { logicalSize: this.restLogicalSize }),
        modifiedAt: this.restModifiedAt || undefined,
        isDir: true,
        children: this.restSample,
        ext: "",
        isOther: true,
        otherCount: this.restCount,
      })
    }

    return {
      children,
      size: this.totalSize,
      ...(this.totalLogicalSize === this.totalSize ? {} : { logicalSize: this.totalLogicalSize }),
      modifiedAt: this.modifiedAt || undefined,
    }
  }
}
