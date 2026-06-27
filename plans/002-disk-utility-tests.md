# Plan 002: Unit tests for the recognition engine, formatters, and color math

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.

> **Drift check (run first)**: `git diff --stat 7c31f6c28..HEAD -- packages/app/src/pages/disk-utility/recognize.ts packages/app/src/pages/disk-utility/format.ts packages/app/src/pages/disk-utility/sunburst.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none (but land before any future change to `recognize.ts`)
- **Category**: tests
- **Planned at**: commit `7c31f6c28`, 2026-06-25

## Why this matters

The Reclaim feature — the product's differentiator — computes a "safe to
delete" total entirely from pure functions: `recognize()` (regex rules → a
safety verdict) and `computeReclaim()` (a tree walk that must NOT double-count
reclaimable subtrees, and must skip `.git`). None of it is tested. A wrong
regex or a broken walk silently inflates the reclaimable figure and steers
users toward deleting the wrong things (this compounds with Plan 001). These
are pure functions with no DOM/IPC — cheap to test, high value. Also cover the
byte/percent formatters and the sunburst hue math, which drive the UI's numbers
and the map↔list color sync.

## Current state

All three modules are pure logic (type-only imports, erased at runtime), so they
run under `bun test` with no DOM or Electron shim.

- `packages/app/src/pages/disk-utility/recognize.ts` — exports:
  - `recognize(node: DiskScanNode): Recognition` (line 108) — basename regex
    rules in `DIR_RULES` (line 35); first match wins; `RECLAIMABLE` set at line
    64 = `["regenerable","cache","logs","trash"]`.
  - `isReclaimable(r)` (line 120) — `RECLAIMABLE.has(r.safety)`.
  - `computeReclaim(root)` (line 146) — walks the tree; when a node is
    reclaimable it adds the whole subtree once and DOES NOT descend (see the
    `return` after counting at ~line 153); otherwise it recurses into children.
  - `fileKind(ext)` (line 84) — extension → kind/safety.
  - `Safety` type (line 14): `regenerable | cache | logs | trash | media |
    version-control | system | unknown`.
- `packages/app/src/pages/disk-utility/format.ts` — `formatBytes`,
  `shortBytes`, `formatPct`, `formatCount`, `truncatePath` (pure).
- `packages/app/src/pages/disk-utility/sunburst.ts` — exported pure helpers:
  - `primaryHueForIndex(i)` (line 148): `(i * 137.508 + 24) % 360`.
  - `primarySegmentColor(i, alpha=1)` (line 153): an `oklch(...)` string built
    from that hue. This formula is shared with the canvas layout so the ranked
    list matches the ring — a regression here silently desyncs the two.

`DiskScanNode` shape (from `@/context/platform`): `{ name, path, size, isDir,
children: DiskScanNode[], ext, isOther?, _label? }`.

Existing test convention to model: tests live next to source as `*.test.ts`,
run with `bun test`. See `packages/app/src/pages/agentboard/board-state.test.ts`
for structure (Bun's built-in `describe/it/expect`).

## Commands you will need

| Purpose   | Command                          | Expected on success |
|-----------|----------------------------------|---------------------|
| Run the new tests | `cd packages/app && bun test src/pages/disk-utility` | all pass |
| Typecheck | `cd packages/app && bun run typecheck` | exit 0, no errors |

## Scope

**In scope** (the only files you should create):
- `packages/app/src/pages/disk-utility/recognize.test.ts`
- `packages/app/src/pages/disk-utility/format.test.ts`
- `packages/app/src/pages/disk-utility/sunburst.test.ts`

**Out of scope** (do NOT modify):
- Any non-test source file. Do not change `recognize.ts`/`format.ts`/`sunburst.ts`.
- If a test reveals a real bug, STOP and report it (see STOP conditions) rather
  than editing source.

## Git workflow

- Branch: `advisor/002-disk-utility-tests`
- One commit: `test(disklizard): cover recognition, formatters, and hue math`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: `recognize.test.ts`

Create the file. Construct `DiskScanNode` literals with a helper (e.g.
`dir(name, size, children=[])` and `file(name, size, ext)`). Cover:

- `recognize` directory rules (assert `.tag` and `.safety`):
  - `node_modules` → `regenerable`, tag "Node dependencies".
  - `__pycache__` → `regenerable`.
  - `.cache` → `cache`.
  - `.git` → `version-control` (NOT reclaimable).
  - `.venv` → `system`.
  - `Logs` → `logs`.
  - `node_modules` spelled with different case where the regex is case-insensitive
    — check the actual `DIR_RULES` regexes and assert the documented behavior
    (most use lowercased basename; if a rule is NOT case-insensitive, assert
    that exact behavior, do not assume).
  - an unrecognized dir → `safety: "unknown"`, no tag.
- `recognize` for files via `fileKind`-driven path: a `.mp4` → `media`/video,
  a `.zip` → archive/unknown safety, a file with no ext → unknown.
- `isReclaimable`: true for regenerable/cache/logs/trash; false for
  version-control/system/media/unknown.
- `computeReclaim` — the critical non-double-counting walk:
  - Build a tree: root → `node_modules` (regenerable, size 100) which itself
    contains a nested `.cache` (cache, size 40). Assert the reclaim total counts
    `node_modules` (100) ONCE and does NOT add the nested `.cache` (i.e. total
    from this subtree = 100, not 140). This locks in the "stop descending on a
    reclaimable node" contract.
  - A `.git` dir (version-control) under root is NOT counted, but its
    non-reclaimable sibling is descended into.
  - A reclaimable item nested under a NON-reclaimable dir (e.g. root → `src`
    (unknown) → `node_modules` (regenerable, 50)) IS counted (the walk descends
    unknown dirs). Total includes 50.
  - `computeReclaim(null)` → `{ totalBytes: 0, totalCount: 0, buckets: [] }`.
  - Buckets are sorted by bytes descending.

**Verify**: `cd packages/app && bun test src/pages/disk-utility/recognize.test.ts` → all pass.

### Step 2: `format.test.ts`

Cover the boundaries that drive displayed numbers:
- `formatBytes(0)` → `"0 B"`; a value that lands `<10` in a unit → 2 decimals;
  `<100` → 1 decimal; `>=100` → rounded. Assert e.g. GB and TB thresholds.
- `shortBytes` compact form.
- `formatPct`: 0 / whole=0 → `"0%"`; tiny → `"<0.1%"`; `<10` → 1 decimal;
  larger → rounded.
- `truncatePath`: short string unchanged; long string starts with `"…"` and has
  the requested length.

**Verify**: `cd packages/app && bun test src/pages/disk-utility/format.test.ts` → all pass.

### Step 3: `sunburst.test.ts`

Cover the map↔list color contract:
- `primaryHueForIndex(0)` === `(0 * 137.508 + 24) % 360`; for `i=1,2,3` it
  matches `(i*137.508+24)%360`.
- `primarySegmentColor(i)` starts with `oklch(` and contains the hue from
  `primaryHueForIndex(i)`; with `alpha=0.5` it contains ` / 0.5`.
- The hue strictly differs between consecutive indices (golden-angle separation).

**Verify**: `cd packages/app && bun test src/pages/disk-utility/sunburst.test.ts` → all pass.

### Step 4: Whole-feature test run + typecheck

**Verify**:
- `cd packages/app && bun test src/pages/disk-utility` → all pass
- `cd packages/app && bun run typecheck` → exit 0

## Test plan

This plan IS the test plan. Pattern file: `packages/app/src/pages/agentboard/board-state.test.ts`.

## Done criteria

ALL must hold:

- [ ] `cd packages/app && bun test src/pages/disk-utility` exits 0, all new tests pass
- [ ] `cd packages/app && bun run typecheck` exits 0
- [ ] `git status` shows only the three new `*.test.ts` files
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:
- The code at the locations in "Current state" doesn't match the excerpts.
- A test fails because `recognize`/`computeReclaim` behaves differently than
  described — that is a real bug; report it (and propose a Plan-001-style fix
  plan) rather than weakening the assertion or editing source.
- `bun test src/pages/disk-utility` fails to resolve `@/context/platform` at
  runtime (it should not — the imports are type-only — but if it does, report;
  do not add a DOM/alias shim).

## Maintenance notes

- These tests are the safety net for the Reclaim engine. Any new recognizer
  rule (e.g. the stale-version hunter in Plan 006) should add a case here.
- The non-double-counting test (Step 1) is the most important assertion in the
  feature — protect it when refactoring `computeReclaim`.
