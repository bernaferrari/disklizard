# Plan 007 (spike): Scan multiple disks concurrently (tabs)

> **Executor instructions**: This is a design/spike plan for the largest of the
> direction items. Investigate, propose the state model, prototype the smallest
> slice, and list open questions. Do NOT attempt a full build-out. Stop at any
> STOP condition. Update the status row in `plans/README.md`.

> **Drift check (run first)**: `git diff --stat 7c31f6c28..HEAD -- packages/app/src/pages/disk-utility/index.tsx packages/desktop/src/main/ipc.ts`
> On mismatch vs. "Current state", treat as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: Plan 001 (trash safety must be correct before enabling more
  deletion surfaces) and Plan 002 (tests for the engine before generalizing state)
- **Category**: direction (feature)
- **Planned at**: commit `7c31f6c28`, 2026-06-25

## Why this matters

The user wants to scan several disks at once (like DaisyDisk). Today the whole
feature is built around a single in-flight scan: one `treeRoot`, one `viewNode`,
one `scanning`, one `scanToken`, one sunburst instance, and a single set of
selection/query state. Making scans concurrent means lifting all of that into a
per-scan record and adding a tab/switcher — a real architecture change. This
spike defines the target state model and prototypes the smallest version (two
disks, switchable) so the refactor scope is concrete before committing to it.

## Current state

`packages/app/src/pages/disk-utility/index.tsx` — single-scan state, all flat:
- `treeRoot`, `viewNode`, `scanLabel`, `scanning`, `scanFiles`, `scanTotal`,
  `scanPct`, `scanBytes`, `scanTail`, `selectedPath`, `hoveredPath`, `focusIdx`,
  `query`, `reviewOpen`, `reclaimDisplay`, plus `scanToken`/`scanMaxBytes`/
  `scanUnsub` for cancellation/progress.
- `startScan(path,label,total)` runs one scan and swaps this state; `cancelScan`
  invalidates it; the sunburst (`canvasEl`/`sunburst` signals) is bound to the
  single tree.
- The scanner itself (`scanPath` via IPC `disklizard:scan-path`) already runs in
  a worker per call, so the backend can run several concurrently — the limit is
  the renderer state model, not the scanner.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Typecheck | `cd packages/app && bun run typecheck` | exit 0 |
| Build | `cd packages/app && bun run build` | exit 0 |

## Scope (for the spike — smallest credible slice)

**In scope** (prototype only):
- A `ScanTab` state shape proposal (see Step 1) and a `tabs` store (array +
  active id) replacing the flat fields, behind the existing UI.
- Two-disk prototype: start a scan on disk A, start another on disk B without
  cancelling A, switch between them, each preserving its own tree/selection.
- A minimal tab strip to switch.

**Out of scope** (follow-ups, explicitly deferred):
- Persisting tabs across app restarts; tab close/confirm; per-tab reclaim drawer
  state; memory caps on number of concurrent trees.
- Re-architecting the sunburst lifecycle (one canvas reused vs one per tab) —
  the spike may keep a single canvas re-bound on tab switch.

## Steps

### Step 1: Define the state model (design artifact — write it in the PR)

Propose a `ScanTab` record that bundles the currently-flat fields:

```ts
type ScanTab = {
  id: string
  path: string; label: string; total: number
  treeRoot: DiskScanNode | null; viewNode: DiskScanNode | null
  scanning: boolean; scanPct: number; scanBytes: number; scanFiles: number; scanTail: string
  selectedPath?: string; hoveredPath?: string | null; focusIdx: number; query: string
  scanToken: number; scanMaxBytes: number
}
```

plus a `tabs: ScanTab[]`, `activeId`, and accessors that read/write the active
tab. Document the trade-offs (single shared sunburst re-bound on switch vs. a
canvas per tab) and pick one for the prototype (recommend: single canvas
re-bound on switch — cheapest).

**Verify**: nothing to run — this is a written design; include it in the PR.

### Step 2: Prototype two concurrent scans

Refactor `startScan` to create/select a tab and write progress into THAT tab's
record (keyed by token), so starting a second scan no longer clobbers the first.
`cancelScan`/`goUp`/`drill`/selection operate on the active tab. Add a minimal
tab strip to switch `activeId`; switching rebinds the sunburst via
`setData(tab.treeRoot, tab.viewNode)`.

**Verify**:
- `cd packages/app && bun run typecheck` → exit 0
- `cd packages/app && bun run build` → exit 0
- Manual: scan disk A, switch to drives, scan disk B, switch back to A — A's
  tree/selection is intact and B's scan continued.

### Step 3: Record what's still needed

List (in the PR) the deferred items (persist, close, memory caps, per-tab
reclaim drawer, sunburst-per-tab) with rough effort, so a follow-up plan can be
written from this spike's findings.

## Done criteria (for the spike)

- [ ] `cd packages/app && bun run typecheck` and `bun run build` exit 0
- [ ] Two disks can be scanned without one cancelling the other; switching
      preserves each tab's tree and selection
- [ ] The `ScanTab` design + the deferred-work list are written in the PR
- [ ] `plans/README.md` status row updated

## Open questions

1. One shared sunburst re-bound on tab switch, or one canvas per tab? (Re-bound
   is cheaper; per-tab keeps animations but uses more memory.)
2. How many concurrent full-disk trees can the renderer hold before memory
   pressure? (Each scan tree is bounded by maxChildren/depth, but a whole-disk
   tree is still sizable.) Propose a cap + LRU eviction.
3. Should a background tab's scan keep the rAF loop (Plan 003) alive? Recommend
   no — only the active tab renders.

## STOP conditions

Stop and report if:
- Lifting the flat state into per-tab records requires touching the sunburst
  engine's internals (not just call sites) — the blast radius is larger than a
  spike; report and recommend a dedicated refactor plan.
- Concurrent workers cause main-process contention or IPC throttling that
  degrades the UI — report the measured impact rather than proceeding.

## Maintenance notes

- This spike is explicitly not the final design — its output is the `ScanTab`
  model and the deferred-work list, which feed a future build plan.
- Until memory caps are decided, cap concurrent scans low (e.g. 3) to avoid OOM
  on whole-disk trees.
