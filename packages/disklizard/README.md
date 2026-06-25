# @opencode-ai/disklizard

Shared **disk space map** for OpenCode — one scanner, one tree model, two surfaces:

| Surface | Entry |
|---------|--------|
| **Desktop** | `packages/desktop` → Electron + sunburst (imports this package) |
| **TUI** | `bun packages/disklizard/bin/disklizard.ts [path]` |

## Why shared

SpaceX-grade tools don't duplicate physics. The traversal algorithm (`scan.ts`), types, formatting, and tree navigation live here. Desktop adds OpenCode themes + canvas; TUI adds ANSI bars + vim keys. Same numbers, same model.

## TUI

```bash
# from opencode repo root
bun packages/disklizard/bin/disklizard.ts
bun packages/disklizard/bin/disklizard.ts ~/Library
bun packages/disklizard/bin/disklizard.ts C:\Users
```

| Key | Action |
|-----|--------|
| `↑↓` `j`/`k` | Move |
| `enter` `l` | Drill in |
| `esc` `h` `backspace` | Parent (root exits) |
| `r` | Rescan |
| `o` | Print selected path → stderr |
| `d` then `y` | Delete (confirm) |
| `?` | Help |
| `q` | Quit |

## Desktop

```bash
bun dev:desktop
```

Uses `scanPath` / `getDrives` / `deleteDiskPath` from this package via `packages/desktop/src/main/disk-scanner.ts`.

## API

```ts
import { scanPath, getDrives, formatBytes, buildCrumbs } from "@opencode-ai/disklizard"

const tree = await scanPath("/some/path", {
  maxDepth: 10,
  onProgress: (p) => console.log(p.filesScanned),
})
```

## Layout

```
packages/disklizard/
  src/
    scan.ts      # fast concurrent traversal (+ optional worker)
    types.ts     # DiskNode, DriveInfo, …
    format.ts    # formatBytes, formatPct
    tree.ts      # crumbs, findParent, sortedChildren
    tui/         # terminal app + ANSI render
    index.ts     # public exports
  bin/disklizard.ts
packages/desktop/src/main/disk-scanner.ts  # re-export adapter
packages/desktop/src/renderer/disklizard/   # GUI only
```
