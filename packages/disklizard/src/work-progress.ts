/** Split traversal work among directories, or files when this is a leaf.
 * Skipped entries never consume the budget of subtrees still being scanned.
 */
export function traversalWorkWeights<T>(entries: readonly T[], classify: (entry: T) => "directory" | "file" | "skip") {
  const kinds = entries.map(classify)
  const target = kinds.includes("directory") ? "directory" : "file"
  const count = kinds.filter((kind) => kind === target).length
  return kinds.map((kind) => count > 0 && kind === target ? 1 / count : 0)
}
