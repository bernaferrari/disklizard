# Plan 001: Deletions go to the system Trash, not `rm -rf`

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.

> **Drift check (run first)**: `git diff --stat 7c31f6c28..HEAD -- packages/desktop/src/main/ipc.ts packages/desktop/src/main/disk-scanner.ts packages/disklizard/src/scan.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: MED
- **Depends on**: none
- **Category**: bug (safety / data-loss)
- **Planned at**: commit `7c31f6c28`, 2026-06-25

## Why this matters

The UI tells users deletion is recoverable — the delete modal is titled
"Move to trash?", the success toast says "Moved to trash", and the Reclaim
review drawer states "Items move to trash — restore if needed." But the
implementation permanently destroys the data with `rm -rf`. A user who trusts
the "restore if needed" copy and clears a `node_modules` or build cache they
actually needed will lose it irrecoverably. This is the highest-severity issue
in the feature. The fix routes deletions through Electron's `shell.trashItem`,
which uses the OS Trash/Recycle Bin (recoverable), and which the same file
already uses for `shell.showItemInFolder`.

## Current state

The desktop main process handles the delete IPC by calling a scanner function
that permanently removes the path:

- `packages/desktop/src/main/ipc.ts:11` imports it:
  `import { deleteDiskPath, getDrives, scanPath } from "./disk-scanner"`
- `packages/desktop/src/main/ipc.ts:63` is the handler:
  ```ts
  ipcMain.handle("disklizard:delete-path", (_event: IpcMainInvokeEvent, targetPath: string) => deleteDiskPath(targetPath))
  ```
- `packages/disklizard/src/scan.ts:668-672` is the permanent delete:
  ```ts
  export async function deleteDiskPath(targetPath: string) {
    await rm(targetPath, { recursive: true, force: true })
    return { ok: true }
  }
  ```
- `packages/desktop/src/main/disk-scanner.ts:8-17` re-exports `deleteDiskPath`
  (among others) from `../../../disklizard/src/scan`.
- `shell` from `electron` is already imported in `ipc.ts` (used at line 65 for
  `shell.showItemInFolder`, line 198 `shell.openExternal`, line 202
  `shell.openPath`). The renderer calls `api.deletePath(node.path)` which
  invokes `disklizard:delete-path`; on rejection, `trashNode` in
  `packages/app/src/pages/disk-utility/index.tsx` already shows an error toast,
  so throwing from the handler surfaces to the user correctly.

Repo conventions: Electron main-process code lives in `packages/desktop/src/main`;
`shell` from `electron` is the established cross-platform FS-integration API here.
Commit style is conventional commits, scoped `disklizard` (see
`git log --oneline`, e.g. `fix(disklizard): …`).

## Commands you will need

| Purpose   | Command                          | Expected on success |
|-----------|----------------------------------|---------------------|
| Typecheck (desktop, covers main + scanner) | `cd packages/desktop && bun run typecheck` | exit 0, no errors |
| Typecheck (scanner pkg) | `cd packages/disklizard && bun run typecheck` | exit 0, no errors |
| Build desktop | `cd packages/desktop && bun run build` | exit 0 |

## Scope

**In scope** (the only files you should modify):
- `packages/desktop/src/main/ipc.ts` — change the `disklizard:delete-path`
  handler to call `shell.trashItem`, drop the `deleteDiskPath` import.
- `packages/desktop/src/main/disk-scanner.ts` — drop `deleteDiskPath` from the
  re-export list.
- `packages/disklizard/src/scan.ts` — delete the `deleteDiskPath` function; if
  `rm` from `node:fs/promises` becomes unused, drop it from the import on line 6.

**Out of scope** (do NOT touch):
- `packages/app/src/pages/disk-utility/index.tsx` — the renderer already says
  "trash" and handles rejection; no change needed. The IPC channel name
  (`disklizard:delete-path`) and the renderer's `api.deletePath` stay the same.
- The preload (`packages/desktop/src/preload/index.ts`) — unchanged.

## Git workflow

- Branch: `advisor/001-trash-not-rm`
- Commit per logical unit, conventional style, e.g.
  `fix(disklizard): send deletions to system Trash instead of rm -rf`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Rewrite the delete IPC handler to use the OS Trash

In `packages/desktop/src/main/ipc.ts`, replace the handler at line 63 so it
awaits `shell.trashItem`. `shell.trashItem(fullPath)` returns `Promise<void>`
and throws for paths it cannot trash (already-trashed, some network/external
volumes, permission errors) — let that reject propagate so the renderer's
existing catch shows the error toast. Target shape:

```ts
ipcMain.handle("disklizard:delete-path", async (_event: IpcMainInvokeEvent, targetPath: string) => {
  await shell.trashItem(targetPath)
  return { ok: true }
})
```

Also remove `deleteDiskPath` from the import on line 11 (keep `getDrives,
scanPath`).

**Verify**: `cd packages/desktop && bun run typecheck` → exit 0 (expect a
"deleteDiskPath is not defined" error ONLY in disk-scanner.ts/scan.ts until
Step 2/3; if the error points at ipc.ts, you missed the import edit).

### Step 2: Drop the `deleteDiskPath` re-export

In `packages/desktop/src/main/disk-scanner.ts`, remove `deleteDiskPath` from
the `export { … } from "../../../disklizard/src/scan"` list (keep the other
exports: `scanPath`, `scanPathSync`, `getDrives`, and the types).

**Verify**: `cd packages/desktop && bun run typecheck` → exit 0.

### Step 3: Remove the dead `deleteDiskPath` function

In `packages/disklizard/src/scan.ts`, delete the function at lines 668-672:

```ts
export async function deleteDiskPath(targetPath: string) {
  await rm(targetPath, { recursive: true, force: true })
  return { ok: true }
}
```

Then check whether `rm` from `node:fs/promises` (line 6:
`import { readdir, stat, rm, access } from "node:fs/promises"`) is still
referenced anywhere in the file (`grep -n "\brm(" packages/disklizard/src/scan.ts`).
If the only hit was `deleteDiskPath`, remove `rm` from that import, leaving
`import { readdir, stat, access } from "node:fs/promises"`. `access` is still
used by the Windows drive probe — do not remove it.

**Verify**:
- `cd packages/disklizard && bun run typecheck` → exit 0
- `cd packages/desktop && bun run typecheck` → exit 0
- `cd packages/desktop && bun run build` → exit 0

## Test plan

There is no automated test harness for Electron main IPC in this repo, so this
fix is verified by typecheck/build gates plus a documented manual check (OS
Trash is not reliably testable in CI). Do not invent a mock-based IPC test.

Manual verification (record in the PR, not a test file):
1. Scan a throwaway folder containing a temp file.
2. Select the file → Trash → confirm.
3. Open the OS Trash (macOS: Trash in Dock; Windows: Recycle Bin) and confirm
   the file is present and restorable. Confirm the source file is gone.

## Done criteria

ALL must hold:

- [ ] `cd packages/desktop && bun run typecheck` exits 0
- [ ] `cd packages/disklizard && bun run typecheck` exits 0
- [ ] `cd packages/desktop && bun run build` exits 0
- [ ] `grep -rn "deleteDiskPath" packages/` returns no matches
- [ ] `grep -n "shell.trashItem" packages/desktop/src/main/ipc.ts` returns the handler
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:
- The code at the locations in "Current state" doesn't match the excerpts
  (drifted since `7c31f6c28`).
- `rm` is referenced somewhere other than `deleteDiskPath` (then do NOT remove
  it from the import — report instead).
- `shell.trashItem` is not available in the project's Electron version (it has
  existed since Electron 0.x; only stop if the typecheck says it's missing).

## Maintenance notes

- `shell.trashItem` is async and throws on edge cases; the renderer's `trashNode`
  catch already surfaces failures as a toast — keep that error path intact.
- A whole-volume root (e.g. `/`) or a path the user can't trash will now reject
  instead of silently destroying; that is the intended, safer behavior.
- If a future "secure/permanent delete" option is added, it must be opt-in and
  clearly labeled — never the default, and never behind "trash" wording.
