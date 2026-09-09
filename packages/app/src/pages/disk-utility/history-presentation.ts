import type { ScanHistoryChange, ScanHistoryEntry } from "./scan-history"

type HistoryItem = ScanHistoryChange & { recordedAt: number; aggregate: boolean }

/** One net change per path over the retained history, newest activity first. */
export function consolidateHistoryChanges(entries: readonly ScanHistoryEntry[]): HistoryItem[] {
  const items = new Map<string, HistoryItem>()
  for (const entry of [...entries].sort((a, b) => a.recordedAt - b.recordedAt)) {
    for (const change of entry.changes) {
      const earlier = items.get(change.path)
      const beforeBytes = earlier?.beforeBytes ?? change.beforeBytes
      const kind = earlier?.kind === "added" && change.kind !== "removed" ? "added"
        : change.kind === "removed" ? "removed" : earlier ? "changed" : change.kind
      items.set(change.path, {...change, kind, beforeBytes,
        deltaBytes: (earlier?.deltaBytes ?? 0) + change.deltaBytes, recordedAt: entry.recordedAt,
        aggregate: change.path === entry.rootPath})
    }
  }
  return [...items.values()].filter(item => item.deltaBytes !== 0 || item.kind !== "changed")
    .sort((a, b) => b.recordedAt - a.recordedAt || Math.abs(b.deltaBytes) - Math.abs(a.deltaBytes))
}
