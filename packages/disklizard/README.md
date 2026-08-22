# `@disklizard/core`

Shared scanning, tree, safety, formatting, and terminal primitives for DiskLizard.

The Electron desktop app prefers the native Rust scanner in `native-scanner/`. If that binary is unavailable or fails to start, it falls back to the TypeScript worker scanner exported by this package. Both produce the same `DiskNode` model.

See the [project README](../../README.md) for product features, desktop setup, platform behavior, and the cleanup safety model.

## Terminal interface

From the repository root:

```bash
bun disklizard
bun disklizard ~/Library
```

Or invoke the entry point directly:

```bash
bun packages/disklizard/bin/disklizard.ts /path/to/inspect
```

| Key                           | Action                                           |
| ----------------------------- | ------------------------------------------------ |
| `↑` / `↓` or `J` / `K`        | Move                                             |
| `Enter` or `L`                | Open the selected directory                      |
| `Escape`, `H`, or `Backspace` | Move to the parent; exit from the root           |
| `R`                           | Rescan                                           |
| `O`                           | Print the selected path to stderr                |
| `D`                           | Show safe cleanup guidance (the TUI is read-only) |
| `?`                           | Show help                                        |
| `Q`                           | Quit                                             |

## API

```ts
import { buildCrumbs, formatBytes, getDrives, scanPath } from "@disklizard/core"

const controller = new AbortController()

const tree = await scanPath("/path/to/project", {
  maxDepth: 10,
  sizeMode: "physical",
  preserveNames: ["node_modules", "target", ".gradle", ".codex", ".claude"],
  developerArtifactInventory: { maxItems: 4_000 },
  onProgress(progress) {
    console.log(progress.filesScanned, formatBytes(progress.size))
  },
  signal: controller.signal,
})

console.log(buildCrumbs(tree, tree))
console.log(await getDrives())
```

`getDrives()` has a short first-paint budget on macOS, so optional APFS facts
may not be present on its first result. Hosts that can refresh their UI should
request `getDriveFacts(path)` afterwards and merge the returned `DriveFacts`
by path. It shares any in-flight `diskutil` request and reports evidence only;
it never returns a snapshot byte estimate or a management action.

### Important scan options

| Option                       | Purpose                                                                           |
| ---------------------------- | --------------------------------------------------------------------------------- |
| `sizeMode`                   | Use physical allocation or logical file length                                    |
| `maxDepth`                   | Stop materializing children beyond a depth while continuing to measure their size |
| `maxChildren`                | Bound the number of child nodes retained per directory                            |
| `preserveNames`              | Retain named artifacts even when they would otherwise be grouped into `Other`     |
| `collapseNames`              | Measure a named directory now and expand it only during a focused scan            |
| `signatureNames`             | Keep bounded evidence used to recognize collapsed developer artifacts             |
| `excludePaths`               | Avoid crossing into nested mount points during a volume scan                      |
| `developerArtifactInventory` | Opt in to a bounded root-only index of recognized developer artifacts beyond map depth |
| `onProgress`                 | Receive throttled counts, bytes, paths, and compact root discoveries              |
| `signal`                     | Cancel traversal with an `AbortSignal`                                            |

### Deep developer-artifact inventory

`developerArtifactInventory` is off by default so a normal map scan stays map-focused. Set it to `true` for the default cap of 2,000 retained records, or pass `{ maxItems }` for a cap from 1 through 20,000. The root then exposes `developerArtifactInventory`; it is intentionally separate from `children`, so recognized folders can be indexed below visual depth or child limits without expanding the rendered tree.

Each entry has a measured aggregate size, modification time when available, inferred ecosystem, confidence, local evidence, and a cleanup posture:

- `eligible` means a known regenerable or redownloadable artifact may be bulk-selected **for review** by a host. It is never an instruction to delete.
- `review` means the name is conventional but ambiguous without enough direct local evidence. Hosts should keep it visible but require individual inspection rather than auto-selecting it.

Hosts should describe age-qualified results as **unchanged for** a number of days based on mtime, not “last used”; reads need not update mtime. An inventory recognizes curated directory patterns and local direct-entry evidence, rather than parsing projects or promising discovery of every build artifact.

The root-level inventory status reports `complete` or `partial`, retained and matched counts, and bounded samples for unreadable paths, excluded paths, and skipped symlinks. A result is `partial` if any of those scopes are present or the item cap truncated retained records. That status is coverage information, not a safety or reclaim-byte guarantee. Artifact roots may nest, so hosts must de-duplicate descendants of selected ancestors before summing sizes or preparing a bulk cleanup review.

Physical mode uses allocated blocks where the platform exposes them and avoids charging secondary hard links twice. `logicalSize` preserves apparent bytes on files and aggregate directories, so a map can explain the difference without hiding pathnames. When every filesystem-reported pathname of one hard-link inode is still retained, the scanner deterministically marks the lexical first path as its `primary`; a pruned, collapsed, unreadable, or inconsistent group keeps the original one-charge result instead. That marker is map accounting, not a per-path reclaim prediction.

On macOS, the native scanner reads APFS clone flags and emits per-file `clone` evidence only when it is meaningful (`may-share-blocks`, `shares-all-blocks`, or an indeterminate result). Inert `not-shared`/unavailable states are omitted to keep large scan payloads compact; absence is never a claim that a file is not shared. The scan root carries `cloneMetadata` (`available`, `unknown`, or `unavailable` with a reason), so a degraded TypeScript fallback remains explicit without repeating that state for every file. Physical scan roots also carry `sharedStorageEvidence`: `complete` means every retained hard-link/clone clue is still represented, while `partial` means a collapsed, trimmed, excluded, or unreadable branch may hide one. Treat an omitted or `partial` value as uncertain, never as a reclaim-byte estimate. Evidence alone never changes `size`: a partial scan cannot safely attribute shared blocks to one pathname. Only a complete, filesystem-confirmed full-clone group gains `cloneAccounting` (`primary`/`secondary`); then one deterministic primary carries the physical bytes and every secondary retains its `logicalSize`. That partition is for map visualization, not a per-file reclaim prediction: deleting one clone can free no bytes while another clone still references the blocks. The portable TypeScript scanner likewise omits clone evidence rather than guessing from names, sizes, or file contents. Snapshot counts and the bounded `apfsSnapshots` evidence list (name/UUID, purgeable and Time Machine markers) are informational only: macOS does not expose reliable per-snapshot byte totals.

## Build and test

```bash
bun run --cwd packages/disklizard native:build
bun run --cwd packages/disklizard native:test
bun run --cwd packages/disklizard typecheck
```

## Layout

```text
packages/disklizard/
  bin/disklizard.ts       TUI entry point
  native-scanner/         Rust scanner and tests
  scripts/build-native.ts Release build and desktop copy step
  src/
    scan.ts               TypeScript traversal and drive discovery
    safety.ts             Cross-platform protected-path policy
    tree.ts               Navigation and tree helpers
    format.ts             Byte and percentage formatting
    tui/                  Terminal application and renderer
    types.ts              Shared public types
    index.ts              Public exports
```
