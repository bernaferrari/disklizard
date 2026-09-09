import { appendFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

export const DELETION_HISTORY_BYTES = 1024 * 1024
export const DELETION_HISTORY_ENTRIES = 2000
export const DELETION_HISTORY_AGE_MS = 90 * 24 * 60 * 60 * 1000
export type DeletionHistoryEntry = {
  path: string
  deletedAt: number
  action: "trash"
  /** Scan-time estimate, not a claim about physically reclaimed disk space. */
  estimatedBytes?: number
  kind?: "file" | "directory"
}

/** Serialized, append-only between compactions. Never walks deleted trees. */
export class DiskDeletionHistory {
  private pending: Promise<void> = Promise.resolve()
  private lines: { entry: DeletionHistoryEntry; line: string; bytes: number }[] | undefined
  private bytes = 0
  constructor(private file: string, private now = Date.now) {}

  record(path: string, metadata?: { estimatedBytes?: number; kind?: string }): Promise<void> {
    const entry: DeletionHistoryEntry = {
      path, deletedAt: this.now(), action: "trash",
      ...(Number.isSafeInteger(metadata?.estimatedBytes) && metadata!.estimatedBytes! >= 0 ? { estimatedBytes: metadata!.estimatedBytes } : {}),
      ...(metadata?.kind === "file" || metadata?.kind === "directory" ? { kind: metadata.kind } : {}),
    }
    const task = this.pending.then(() => this.append(entry))
    // One write failure must not poison all later records.
    this.pending = task.catch(() => { this.lines = undefined })
    return task
  }

  async prune(): Promise<void> {
    const task = this.pending.then(async () => { await this.load(); await this.compact() })
    this.pending = task.catch(() => { this.lines = undefined })
    return task
  }

  private async load() {
    if (this.lines) return
    this.lines = []
    this.bytes = 0
    try {
      // Refuse an oversized/corrupt history before allocating it into memory.
      if ((await stat(this.file)).size <= DELETION_HISTORY_BYTES) {
        for (const line of (await readFile(this.file, "utf8")).split("\n")) {
          try {
            const entry = JSON.parse(line) as DeletionHistoryEntry
            if (entry.action !== "trash" || typeof entry.path !== "string" || !Number.isSafeInteger(entry.deletedAt)) continue
            const encoded = JSON.stringify(entry) + "\n"
            const bytes = Buffer.byteLength(encoded)
            this.lines.push({ entry, line: encoded, bytes })
            this.bytes += bytes
          } catch { /* Recover complete records after an interrupted append. */ }
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }
    await this.compact()
  }

  private async compact() {
    const cutoff = this.now() - DELETION_HISTORY_AGE_MS
    this.lines = this.lines!.filter(({ entry }) => entry.deletedAt >= cutoff).slice(-DELETION_HISTORY_ENTRIES)
    this.bytes = this.lines.reduce((sum, row) => sum + row.bytes, 0)
    while (this.bytes > DELETION_HISTORY_BYTES && this.lines.length) this.bytes -= this.lines.shift()!.bytes
    await mkdir(dirname(this.file), { recursive: true })
    // Only one bounded temporary file; rename prevents a partial rewrite.
    await writeFile(this.file + ".tmp", this.lines.map((row) => row.line).join(""), { mode: 0o600 })
    await rename(this.file + ".tmp", this.file)
  }

  private async append(entry: DeletionHistoryEntry) {
    const line = JSON.stringify(entry) + "\n"
    const bytes = Buffer.byteLength(line)
    if (bytes > DELETION_HISTORY_BYTES) return
    await this.load()
    const row = { entry, line, bytes }
    if (this.bytes + bytes > DELETION_HISTORY_BYTES || this.lines!.length >= DELETION_HISTORY_ENTRIES ||
      this.lines!.some(({ entry }) => entry.deletedAt < this.now() - DELETION_HISTORY_AGE_MS)) {
      // Leave headroom so reaching the cap does not trigger a rewrite per deletion.
      this.lines = this.lines!.slice(Math.ceil(this.lines!.length * 0.2))
      this.lines.push(row)
      await this.compact()
    } else {
      await appendFile(this.file, line, { mode: 0o600 })
      this.lines!.push(row)
      this.bytes += bytes
    }
  }
}

/** Successful Trash operations stay successful even if the audit disk is unavailable. */
export async function trashWithHistory(
  path: string,
  metadata: { estimatedBytes?: number; kind?: string } | undefined,
  trash: (path: string) => Promise<void>,
  history: DiskDeletionHistory,
  reportError: (error: unknown) => void,
) {
  await trash(path)
  await history.record(path, metadata).catch(reportError)
}
