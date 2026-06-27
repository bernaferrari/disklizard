# Plan 004: Remove dead code (ignored `size` param, unused exports)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.

> **Drift check (run first)**: `git diff --stat 7c31f6c28..HEAD -- packages/disklizard/src/scan.ts packages/app/src/pages/disk-utility/ui-tokens.ts packages/app/src/pages/disk-utility/sunburst.ts`
> If any in-scope file changed since this plan was written, compare "Current
> state" against live code; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (apply after Plan 003 if both land, since both touch `sunburst.ts`)
- **Category**: tech-debt
- **Planned at**: commit `7c31f6c28`, 2026-06-25

## Why this matters

Three pieces of dead/misleading code accumulated during the redesign: (1)
`emitProgress`'s `size` argument is now ignored (the function always reports
`st.scannedBytes`), so callers passing a per-file size look like they do
something they don't — a trap for the next reader; (2) `DRIVE_ACCENT` is
exported but no longer imported anywhere after the drive-card redesign; (3)
`isDiskScanNode` is exported but unused. Removing them keeps the surface honest
and shrinks review noise.

## Current state

- `packages/disklizard/src/scan.ts:110` — `emitProgress` signature:
  ```ts
  function emitProgress(st: WalkState, currentPath: string, size: number, force = false) {
  ```
  The body reports `size: st.scannedBytes` (the `size` arg is unused). Callers
  pass a size positionally — find them with `grep -n "emitProgress(" packages/disklizard/src/scan.ts`
  (at least one at ~line 217: `emitProgress(st, dirPath, st.scannedBytes)`).
- `packages/app/src/pages/disk-utility/ui-tokens.ts:15` —
  `export const DRIVE_ACCENT: Record<"local"|"removable"|"network", Accent> = { … }`.
  No longer imported (the drive card uses `usageStroke` instead). The `Accent`
  type is still used by `SAFETY_ACCENT` — keep `Accent`, delete only `DRIVE_ACCENT`.
- `packages/app/src/pages/disk-utility/sunburst.ts:677` —
  `export function isDiskScanNode(n: unknown): n is DiskScanNode { … }` — unused.

Confirm "unused" before deleting (see Step 1 verification).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Typecheck (scanner) | `cd packages/disklizard && bun run typecheck` | exit 0 |
| Typecheck (app) | `cd packages/app && bun run typecheck` | exit 0 |

## Scope

**In scope**:
- `packages/disklizard/src/scan.ts` — drop the `size` param from `emitProgress`
  and update its callers.
- `packages/app/src/pages/disk-utility/ui-tokens.ts` — delete `DRIVE_ACCENT`.
- `packages/app/src/pages/disk-utility/sunburst.ts` — delete `isDiskScanNode`.

**Out of scope**:
- Do NOT remove the `Accent` type, `SAFETY_ACCENT`, `usageStroke`, `scanPathSync`
  (it's used as the worker fallback in `scanPath`), or anything else that's still referenced.

## Git workflow

- Branch: `advisor/004-remove-dead-code`
- Commit: `chore(disklizard): drop dead emitProgress param and unused exports`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Confirm the exports are actually unused

Run:
- `grep -rn "DRIVE_ACCENT" packages/` → expect matches ONLY in `ui-tokens.ts`.
- `grep -rn "isDiskScanNode" packages/` → expect a match ONLY in `sunburst.ts`.

If either is referenced anywhere else, STOP and report (it's not dead).

**Verify**: the two greps return only the definition sites.

### Step 2: Drop the `emitProgress` size parameter

In `packages/disklizard/src/scan.ts`, change the signature to
`function emitProgress(st: WalkState, currentPath: string, force = false)`.
Then update every caller found by `grep -n "emitProgress(" packages/disklizard/src/scan.ts`
to drop the now-removed positional `size` argument (e.g.
`emitProgress(st, dirPath, st.scannedBytes)` → `emitProgress(st, dirPath)`,
`emitProgress(st, dirPath, x, true)` → `emitProgress(st, dirPath, true)`).

**Verify**: `cd packages/disklizard && bun run typecheck` → exit 0.

### Step 3: Delete `DRIVE_ACCENT`

In `packages/app/src/pages/disk-utility/ui-tokens.ts`, delete the entire
`DRIVE_ACCENT` const (the `export const DRIVE_ACCENT: Record<…> = { … }` block).
Leave `Accent`, `SAFETY_ACCENT`, `usageTone`, `usageStroke`, etc.

**Verify**: `cd packages/app && bun run typecheck` → exit 0.

### Step 4: Delete `isDiskScanNode`

In `packages/app/src/pages/disk-utility/sunburst.ts`, delete the
`export function isDiskScanNode(…) { … }` function.

**Verify**: `cd packages/app && bun run typecheck` → exit 0.

## Test plan

No new tests — this is deletion of unused code, covered by typecheck (unused
removals that break a caller fail the typecheck).

## Done criteria

ALL must hold:

- [ ] `cd packages/disklizard && bun run typecheck` exits 0
- [ ] `cd packages/app && bun run typecheck` exits 0
- [ ] `grep -rn "DRIVE_ACCENT\|isDiskScanNode" packages/` returns no matches
- [ ] `grep -n "emitProgress(" packages/disklizard/src/scan.ts` shows the new
      2-/3-arg signature with no stale size argument at call sites
- [ ] `git status` shows only the three in-scope files
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:
- Step 1 finds `DRIVE_ACCENT` or `isDiskScanNode` referenced outside their
  definition file (they are not actually dead — do not delete).
- Removing the `size` param surfaces a caller that genuinely depends on a
  per-event size (report; the right fix may differ).

## Maintenance notes

- None beyond standard: keep the scanner's progress emission reporting the
  cumulative `st.scannedBytes` (the monotonic-progress contract from the
  earlier fix depends on it).
