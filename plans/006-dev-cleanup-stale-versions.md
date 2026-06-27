# Plan 006 (spike): Dev-cleanup filter + stale toolchain/version hunter

> **Executor instructions**: This is a design/spike plan. Prototype the smallest
> version, define the API, list open questions. Stop at any STOP condition.
> Update the status row in `plans/README.md`.

> **Drift check (run first)**: `git diff --stat 7c31f6c28..HEAD -- packages/app/src/pages/disk-utility/recognize.ts packages/app/src/pages/disk-utility/index.tsx packages/disklizard/src/scan.ts`
> On mismatch vs. "Current state", treat as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW–MED
- **Depends on**: Plan 002 (tests must exist before expanding `recognize.ts`)
- **Category**: direction (feature)
- **Planned at**: commit `7c31f6c28`, 2026-06-25

## Why this matters

Two user-requested capabilities build directly on the Reclaim engine:
(1) a "dev-cleanup" mode that filters the view to reclaimable items and sorts
them; (2) a "stale toolchain" hunter that recognizes old versions of tools
people accumulate (IntelliJ app versions, Gradle/pnpm/cargo caches, Xcode
Simulator runtimes) — things users "see a lot that could be eliminated." The
recognizer (`recognize.ts`) and the reclaim aggregation (`computeReclaim`) are
already the seam; this spike extends the rules and adds a lightweight filter UI
without a new data model.

## Current state

- `packages/app/src/pages/disk-utility/recognize.ts`:
  - `DIR_RULES` (line 35): ordered `{ re, safety, tag, hint? }` rules matched
    against the lowercased basename (first match wins). Categories today:
    regenerable (node_modules, build/dist, __pycache__, DerivedData…), cache,
    logs, trash, version-control (.git), system (venv).
  - `RECLAIMABLE` (line 64) = regenerable/cache/logs/trash.
  - `recognize(node)`, `isReclaimable(r)`, `computeReclaim(root)` (non-double-
    counting walk).
  - `fileKind(ext)` for media/archive/code/etc.
- `packages/app/src/pages/disk-utility/index.tsx`: the ranked list reads
  `entries()` = `sortChildren(viewNode)` filtered by `query()` (substring on
  name). The reclaim banner + review drawer already render `computeReclaim`.
- `packages/disklizard/src/scan.ts`: `DiskNode` carries `{ name, path, size,
  isDir, children, ext, isOther?, _label? }` — **no mtime**.

Conventions: pure logic in `recognize.ts` is unit-tested (after Plan 002);
Tailwind v4 + OC tokens for UI; new rules follow the existing `{ re, safety,
tag, hint? }` shape.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Tests (recognition) | `cd packages/app && bun test src/pages/disk-utility/recognize.test.ts` | pass |
| Typecheck | `cd packages/app && bun run typecheck` | exit 0 |
| Build | `cd packages/app && bun run build` | exit 0 |

## Scope (for the spike)

**In scope**:
- `packages/app/src/pages/disk-utility/recognize.ts` — add stale-toolchain rules
  (IntelliJ/Android Studio app bundles, Gradle caches, pnpm/cargo/go module
  stores, Xcode Simulator runtimes) and a new `Safety` value or tag convention
  for "stale-version" (decide in the spike — see open questions).
- `packages/app/src/pages/disk-utility/index.tsx` — add a "Cleanup" filter chip
  that scopes `entries()` to reclaimable (and optionally stale-version) items,
  and a size-desc / name sort toggle.
- `packages/app/src/pages/disk-utility/recognize.test.ts` — cases for the new
  rules and the filter.

**Out of scope** (note as follow-ups / open questions):
- "Sort by date" — `DiskScanNode` has no mtime. Requires a scanner change to
  capture `mtime`/`mtimeMs`; do NOT add it in this spike (see open questions).
- Auto-detecting *which* version is "old" (e.g. comparing IntelliJ build
  numbers) — start with "recognize the install location" and surface all
  versions; let the user decide.

## Steps

### Step 1: Extend the recognizer

Add rules to `DIR_RULES` (match the existing shape) for common stale-toolchain
locations, e.g. IntelliJ/Android Studio install dirs and cache roots, Gradle
caches (`~/.gradle/caches`), pnpm/cargo/go stores, Xcode Simulator runtimes.
Decide and document whether "stale toolchain" maps to an existing safety
(likely `cache` or a new `toolchain` Safety) — the reclaim total should only
include things genuinely safe to remove (old app versions are usually safe;
the *current* IDE install is not). Use path-based hints in `recognize` (there's
already a `PATH_HINTS` array for macOS paths like DerivedData/Library/Caches)
for the OS-specific locations.

**Verify**: `cd packages/app && bun test src/pages/disk-utility/recognize.test.ts` → pass (add cases for each new rule).

### Step 2: Add a "Cleanup" filter + sort to the list

In `index.tsx`, add a small filter control (chip/toggle) near the existing
search input. When active, `entries()` filters to items where
`isReclaimable(recognize(node))` (and/or stale-version). Add a sort toggle
(size desc is the default; add name asc). Keep the substring `query()` working
in combination. The reclaim banner already reflects the whole-tree total; the
filter only changes the list view.

**Verify**: `cd packages/app && bun run typecheck` → exit 0; build → exit 0.

### Step 3: Manual sanity

Scan `~/Library/Caches` or `~/.gradle` (small, fast), enable Cleanup, confirm
only reclaimable/stale items show and the total matches `computeReclaim`.

**Verify**: typecheck + build pass; new recognize tests pass.

## Done criteria (for the spike)

- [ ] `cd packages/app && bun run typecheck` and `bun run build` exit 0
- [ ] `recognize.test.ts` passes with cases for every new rule
- [ ] "Cleanup" filter scopes the list to reclaimable items; sort toggle works;
      reclaim banner total is unchanged by the filter
- [ ] Open questions recorded in the PR (below)

## Open questions

1. Should stale toolchain get its own `Safety` (e.g. `toolchain`) so it can be
   colored/bucketed separately from generic caches? Recommend yes, and add it to
   `RECLAIMABLE` only for the "old version" subset.
2. "Sort by date" needs mtime in `DiskScanNode` — propose a follow-up plan to
   add `mtimeMs?` to the scanner (cheap: `stat.mtimeMs` already fetched during
   the walk). Out of scope here.
3. How to avoid flagging the *active* IDE/runtime as deletable — version
   comparison is hard; recommend showing all and letting the user choose, with a
   clear "current" hint only if detectable cheaply.

## STOP conditions

Stop and report if:
- A proposed rule would require mtime or version comparison to be useful —
  record it as a follow-up rather than expanding scanner state in this spike.
- The "stale toolchain" set is too noisy/false-positive-prone on the maintainer's
  machine to be trustworthy — report and narrow the rule set.

## Maintenance notes

- Every new rule adds a `recognize.test.ts` case (Plan 002's convention).
- Keep the reclaim total conservative: better to under-report than to mark the
  user's active toolchain as safe to delete.
