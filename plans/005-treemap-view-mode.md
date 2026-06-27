# Plan 005 (spike): Treemap / "dive into the squares" view mode

> **Executor instructions**: This is a design/spike plan, not a build-everything
> plan. Prototype the smallest version that proves the approach, define the API,
> and list the open questions. Stop and report at any STOP condition. Update the
> status row in `plans/README.md`.

> **Drift check (run first)**: `git diff --stat 7c31f6c28..HEAD -- packages/app/src/pages/disk-utility/index.tsx packages/app/src/pages/disk-utility/sunburst.ts`
> On mismatch vs. "Current state", treat as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M–L
- **Risk**: MED
- **Depends on**: none (composes with the existing view toggle)
- **Category**: direction (feature)
- **Planned at**: commit `7c31f6c28`, 2026-06-25

## Why this matters

The user explicitly wants a WinDirStat-style "squares you dive into" view. The
infrastructure already exists: a `Map`/`List` view toggle, a scanner tree
(`DiskScanNode`), and a shared color engine (`primarySegmentColor`/`primaryHueForIndex`
in `sunburst.ts`) that already keeps the ranked list in sync with the ring. A
treemap is a natural third mode that reuses all of it — the only genuinely new
piece is a squarified-treemap layout algorithm. This spike validates the layout,
the drill interaction, and how it shares the existing color + navigation state.

## Current state

- `packages/app/src/pages/disk-utility/index.tsx`:
  - `type ScanMode = "map" | "list"` (line 25); `scanMode` signal (line 68,
    default `"map"`).
  - The toggle is two `SegmentedButton`s (lines ~461-462) that call
    `setScanMode("map"|"list")`.
  - The scan body branches on `scanMode()` (line ~608): `"map"` renders the
    sunburst panel; otherwise the list panel goes full-width.
  - Drill navigation: `drill(node)` sets `viewNode` and drives the sunburst;
    the list reads `entries()` (sorted children of `viewNode`).
- `packages/app/src/pages/disk-utility/sunburst.ts`: `primarySegmentColor(i)`
  and `primaryHueForIndex(i)` are the color source of truth; the ranked list
  already uses `primarySegmentColor(entry.index)` so the two stay in sync.
- The scanner caps children at `maxChildren: 48` and depth, so treemap input is
  bounded.

Conventions: SolidJS, Tailwind v4, OC theme tokens (`--text-strong`,
`--surface-panel`, etc.). New view code lives in
`packages/app/src/pages/disk-utility/`.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Typecheck | `cd packages/app && bun run typecheck` | exit 0 |
| Build | `cd packages/app && bun run build` | exit 0 |

## Scope (for the spike)

**In scope**:
- `packages/app/src/pages/disk-utility/treemap.ts` (new) — pure layout: takes
  `DiskScanNode` children + a box, returns rectangles.
- `packages/app/src/pages/disk-utility/Treemap.tsx` (new) — renders the rects,
  handles hover/click/drill, mirrors the sunburst's color + `viewNode` contract.
- `packages/app/src/pages/disk-utility/index.tsx` — extend `ScanMode` to include
  `"grid"`, add the third `SegmentedButton`, render `<Treemap>` in the `"grid"`
  branch using the same `viewNode`/`entries`/`primarySegmentColor` the map uses.

**Out of scope** (for the spike — note as follow-ups):
- Animation/morph transitions between drill levels (the sunburst has these; the
  treemap can start with simple fades).
- Virtualization (children are capped at 48, so not needed yet).

## Steps

### Step 1: Prototype the squarified layout (`treemap.ts`)

Implement a pure function (no DOM) using the squarified treemap algorithm:

```ts
export type TreemapRect = { node: DiskScanNode; index: number; x: number; y: number; w: number; h: number }
export function layoutTreemap(children: DiskScanNode[], box: {x;y;w;h}): TreemapRect[]
```

Sort children by size desc, assign each `index` (so colors match
`primarySegmentColor(index)` — same contract as the list), and squarify into the
box. Keep it ~60 lines; there are reference implementations of "squarify" to
follow. Add a tiny `treemap.test.ts` asserting: total area is partitioned (rects
don't overlap and fill the box within epsilon); a single child fills the box;
zero children returns `[]`.

**Verify**: `cd packages/app && bun test src/pages/disk-utility/treemap.test.ts` → pass.

### Step 2: Render + interact (`Treemap.tsx`)

A component that takes the same inputs the map uses (`viewNode`, `parentSize`,
`onDrill`, hover/selection signals) and:
- measures its container (a `ResizeObserver` or the existing
  `@solid-primitives/resize-observer` already in deps), calls `layoutTreemap`,
- renders each rect as a `<div>` (or SVG `<rect>`) filled with
  `primarySegmentColor(entry.index)`, with the node name as a label that hides
  when the rect is too small,
- on hover sets the same `hoveredPath` used by the list/sunburst (so all three
  views highlight together), on click selects, double-click drills (calls
  `drill(node)`).

**Verify**: `cd packages/app && bun run typecheck` → exit 0.

### Step 3: Wire the third mode (`index.tsx`)

Extend `ScanMode` to `"map" | "list" | "grid"`, add a third `SegmentedButton`
(`icon` e.g. `"dot-grid"`, label "Grid"), and render `<Treemap …/>` in a
`<Show when={scanMode()==="grid"}>…</Show>` branch that reuses `viewNode`,
`entries`'s indexing, and the hover/selection signals. Keep the existing
map/list branches unchanged.

**Verify**:
- `cd packages/app && bun run typecheck` → exit 0
- `cd packages/app && bun run build` → exit 0

## Done criteria (for the spike)

- [ ] `cd packages/app && bun run typecheck` and `bun run build` exit 0
- [ ] `treemap.test.ts` passes (layout invariants)
- [ ] Selecting "Grid" renders a treemap of the current folder; wedges share
      colors with the ranked list (same `primarySegmentColor(index)`); hovering
      a square highlights the matching list row; double-click drills.
- [ ] `plans/README.md` status row updated; open questions recorded (below)

## Open questions to resolve in the spike (record answers in the PR)

1. SVG `<rect>` vs CSS-grid `<div>`s — which is crisper and easier to label/zoom?
2. How deep to render in one frame (one level like the sunburst's primary ring,
   or nested like WinDirStat)? Recommend starting with one level for parity with
   the map.
3. Label readability threshold (min rect size to show a name) — pick a value.

## STOP conditions

Stop and report if:
- The squarified layout is more invasive than expected (e.g. needs a dependency)
  — report and propose the lightest "slice" treemap alternative.
- Sharing the hover/selection signals across a third view creates reactivity
  conflicts — report rather than refactoring the signal model blindly.

## Maintenance notes

- The treemap must reuse `primarySegmentColor(index)` — never invent a parallel
  color system, or the three views will desync.
- It must drive the same `drill`/`viewNode` as the map so breadcrumbs and back
  navigation work identically.
