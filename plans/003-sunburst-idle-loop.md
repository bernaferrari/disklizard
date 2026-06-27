# Plan 003: Stop the sunburst rAF loop when idle; fix the no-op hover ternary

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.

> **Drift check (run first)**: `git diff --stat 7c31f6c28..HEAD -- packages/app/src/pages/disk-utility/sunburst.ts`
> If this file changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, treat it as
> a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: perf (also a small correctness/dead-logic fix)
- **Planned at**: commit `7c31f6c28`, 2026-06-25

## Why this matters

The sunburst `_loop` reschedules `requestAnimationFrame` unconditionally and
redraws the whole canvas (clear + every segment + gradients) every frame, even
when the map is perfectly still. On the scan screen this burns CPU/GPU and
battery for nothing. The fix makes the loop self-terminate when there is no
animation, pulse, or unsettled hover spring, and restart on any event that
changes the picture. While in the file, also remove a confusing dead ternary
in `_onMouseMove`.

## Current state

`packages/app/src/pages/disk-utility/sunburst.ts`:

- The render loop (`_loop`, line ~461) always re-arms:
  ```ts
  _loop() {
    this.raf = requestAnimationFrame((t) => {
      this._tick(t)
      this._draw()
      this._loop()
    })
  }
  ```
- `_tick` (line ~418) advances animation + hover springs; it reads
  `this.animating`, `this.entering`, `this.pulseT`, and per-segment
  `s.hover`/`s.targetHover`.
- The constructor (line ~204) calls `this._loop()`.
- State-changing methods: `setData`, `navigateTo`, `goUp` (all route through
  `_transitionTo`, which sets `this.animating = true`); `setHighlight`,
  `setSelected`; `_onResize`; `_onMouseMove`/`_onClick` (hover/selection).
- Dead logic in `_onMouseMove` (line ~635):
  ```ts
  this.hovered = hit?.type === "center" ? null : null
  ```
  (both branches are `null` — harmless but misleading).

`raf` is already a class field (`raf: number | null = null`) used by `destroy`.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Typecheck | `cd packages/app && bun run typecheck` | exit 0, no errors |
| Build | `cd packages/app && bun run build` | exit 0 |
| Tests | `cd packages/app && bun test src/pages/disk-utility` | pass (incl. Plan 002's hue tests if present) |

## Scope

**In scope** (the only file you should modify):
- `packages/app/src/pages/disk-utility/sunburst.ts`

**Out of scope** (do NOT touch):
- `index.tsx` or any other consumer — the public class API (`Sunburst`, methods
  `setData`/`navigateTo`/`goUp`/`setHighlight`/`setSelected`/`destroy`) must stay
  identical. Only the internal scheduling changes.

## Git workflow

- Branch: `advisor/003-sunburst-idle-loop`
- Commit: `perf(disklizard): idle-stop the sunburst render loop`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Add an idle-aware frame scheduler

Replace the self-rearming `_loop` with a scheduler that stops when idle. Add a
private flag and a `_needsFrame()` predicate, and a `requestFrame()` method
that schedules a frame only if one isn't already pending. Target shape:

```ts
private running = false

/** Schedule a frame iff one isn't already pending. Idempotent — call from every state change. */
private requestFrame() {
  if (this.running) return
  this.running = true
  this.raf = requestAnimationFrame((t) => this._frame(t))
}

private _frame(t: number) {
  this._tick(t)
  this._draw()
  if (this._needsFrame()) {
    this.raf = requestAnimationFrame((n) => this._frame(n))
  } else {
    this.running = false
    this.raf = null
  }
}

/** True when there is animation, an enter pulse, or an unsettled hover spring. */
private _needsFrame(): boolean {
  if (this.animating || this.entering) return true
  for (const s of this.segments) {
    if (s.depth === 0 && Math.abs(s.hover - s.targetHover) > 0.001) return true
  }
  return false
}
```

Delete the old `_loop`. Update the constructor to call `this.requestFrame()`
instead of `this._loop()`. In `destroy`, also set `this.running = false` (the
existing `cancelAnimationFrame(this.raf)` stays).

**Verify**: `cd packages/app && bun run typecheck` → exit 0.

### Step 2: Wake the loop from every state-changing entry point

Because the loop now stops when idle, every method that changes what's drawn
must (re)start it. Add a `this.requestFrame()` call at the end of each of these
methods (it's idempotent, so calling it when already running is a no-op):

- `setData`, `navigateTo`, `goUp` — these set `animating` via `_transitionTo`,
  so after the transition starts they need a frame. Put the call at the end of
  each (after `_transitionTo`).
- `setHighlight` and `setSelected`.
- `_onResize` (radii change → needs a redraw even though nothing animates).
- `_onMouseMove` (after `this.hovered`/cursor updates) and `_onClick` (after
  `selectedPath`/callback).

Concretely, in `_onResize` change it from `this._resize()` to
`this._resize(); this.requestFrame()`. In `_transitionTo` you may instead add a
single `this.requestFrame()` at its end and rely on that for setData/navigateTo/
goUp — either approach is fine as long as all three paths wake the loop.

**Verify**: `cd packages/app && bun run typecheck` → exit 0.

### Step 3: Fix the dead hover ternary

In `_onMouseMove`, simplify the center-hover branch. Replace:

```ts
this.hovered = hit?.type === "center" ? null : null
```

with:

```ts
this.hovered = null
```

(behavior unchanged — both arms were `null`; this just stops misleading readers).

**Verify**: `cd packages/app && bun run typecheck` → exit 0.

### Step 4: Build + tests

**Verify**:
- `cd packages/app && bun run build` → exit 0
- `cd packages/app && bun test src/pages/disk-utility` → pass

## Test plan

No automated test for canvas animation exists in this repo; the regression risk
is "canvas freezes because a wake point was missed," which is visual. Rely on
typecheck/build gates plus a manual check (document in the PR):

1. Scan a folder, confirm the sunburst draws and the enter pulse plays.
2. Hover wedges → the hover lift animates and the linked list row highlights
   (proves `_onMouseMove` wakes the loop).
3. Click a directory wedge → the drill morph animates (proves `navigateTo`
   wakes it).
4. Resize the window → the ring resizes (proves `_onResize` wakes it).
5. Leave the mouse still for >1s → confirm (via DevTools Performance) the rAF
   callback is no longer firing (the loop is idle).

If Plan 002 landed, its hue tests still pass (this plan doesn't touch the hue
formula).

## Done criteria

ALL must hold:

- [ ] `cd packages/app && bun run typecheck` exits 0
- [ ] `cd packages/app && bun run build` exits 0
- [ ] `cd packages/app && bun test src/pages/disk-utility` passes
- [ ] `grep -n "_loop" packages/app/src/pages/disk-utility/sunburst.ts` returns no matches (old method gone)
- [ ] `grep -n "requestFrame" packages/app/src/pages/disk-utility/sunburst.ts` shows the new scheduler + wake calls
- [ ] The no-op ternary (`? null : null`) is gone
- [ ] `git status` shows only `sunburst.ts` changed
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:
- The code at the locations in "Current state" doesn't match the excerpts.
- `_tick`, `_transitionTo`, or the public method signatures differ from what's
  described — the wake-point list in Step 2 depends on those names; if they
  differ, report the actual names rather than guessing.
- You find state-changing methods beyond the list in Step 2 that also draw
  (e.g. a setter that changes colors) — add wake calls for those too, but if
  unsure, STOP and report.

## Maintenance notes

- Future sunburst features that animate (e.g. a treemap mode sharing this
  engine) must call `requestFrame()` from their state changes or they will not
  render. The rule: anything that mutates `segments`, `hovered`, `selectedPath`,
  radii, or animation flags must wake the loop.
- The `running` flag plus `raf` field are the only scheduler state; keep
  `destroy` resetting both.
