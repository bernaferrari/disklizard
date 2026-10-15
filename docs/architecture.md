# Architecture

DiskLizard has three active workspaces. `packages/disklizard` owns scanning and
filesystem models; `packages/desktop` owns native operations, authorization,
watchers and persistence; `packages/app` owns the storage explorer. The renderer
uses the typed preload bridge. The browser fixture is an independent adapter and
never enters the desktop bootstrap.

## Renderer ownership

`index.tsx` composes the workspace hook and the view. The workspace coordinates
feature commands and assembles presentation props. It does not own canvas
implementations, pointer listeners, preview subscriptions or discovery polling.
Presentation regions have explicit contracts; they cannot infer their props from
the workspace hook. Dependency tests enforce this direction.

| Module | Owns | Main invariant |
| --- | --- | --- |
| `scan-workspace.ts` | Active viewport state and transitions | Only the matching foreground request can complete or fail the current scan. |
| `foreground-scans.ts` / `use-foreground-scan.ts` | Foreground request generations and progress subscription | Navigation and supersession retire the native request before any late result can mutate the viewport; provenance can arrive after the tree. |
| `foreground-progress.ts` | Atomic progress snapshots | Late provenance cannot move displayed bytes or percentage backwards. |
| `background-scans.ts` / `use-background-scans.ts` | Parallel scan jobs and their subscriptions | The concurrency limit and duplicate suppression apply synchronously. |
| `use-disk-visualization.ts` | Sunburst canvas, tile camera, morph transitions and disposal | A replaced canvas invalidates pending animation callbacks and restores an interactive destination. |
| `use-disk-investigation.ts` | Recognition, filters, grouping and entry derivation | The ordinary folder view does not eagerly build scan-wide summaries. |
| `use-disk-preview.ts` | Preview controller integration | Entries retain array identity within a generation; removed targets and late reads are reconciled. |
| `use-disk-browse-history.ts` | Browse controller integration | History destinations resolve against the current tree. |
| `use-drive-discovery.ts` | Drive discovery, capacity facts and polling | Old lifetimes cannot commit results or block a new discovery request. |
| `use-workspace-protections.ts` | Saved locations and cleanup protection mutations | Mutation exclusion applies before React has rendered the pending state. |
| `use-collection-drag.ts` | One pointer drag, listeners and review target | Navigation and unmount cancel the drag; cleanup policy is checked again at drop time. |
| `use-cleanup-execution.ts` | Confirmation, authorization, execution and outcomes | Selection never authorizes filesystem removal; current protections are checked during execution. |
| `deletion-reconciliation.ts` | One immutable plan for all retained maps | Shared allocation invalidates completed maps; removed roots cannot be reopened through stale volume cards. |

The viewport has four states: home, scanning, ready and expanding. Root scans
clear the old tree atomically. Focused expansion keeps the trusted root visible;
its completion grafts into the latest watcher tree before committing. Cancellation
of an expansion preserves the active root watcher. Opening a retained map removes
foreground ownership, so a late completion cannot replace it.

The workspace's small live ref is reserved for callbacks that cross an asynchronous
lifecycle. Keyboard routing has its own typed context. Each feature adapter owns
its own current options rather than accessing the entire workspace.

## Presentation

`DiskUtilityView` composes the header, protection notice, overview, cleanup
workspace, landscape, index panel and dialogs. These regions own markup and
forward user intent through their contracts. Native filesystem access remains behind the preload adapter. Scan-job types live in `scan-jobs.ts`, independently of
the drive cards that display them.

## Verification

The canonical suite exercises the state transitions, request controllers,
delete reconciliation and layer contracts. The browser journey exercises
confirmation, keyboard expansion, browse history and switching workspaces while
a map transition is running. Production benchmarks are recorded before and after
session changes. The packaged smoke journey covers actual native scanning,
snapshot restoration, previews and Trash. See [benchmarking](benchmarking.md) for
the measurement workflow.

## Snapshot and shutdown guarantees

Snapshot schema 9 invalidates older accounting generations. Lost journal
continuity and live watcher errors carry explicit whole-root invalidation;
ordinary ancestor-event coalescing cannot narrow it. Updates beneath a synthetic
Other sample refresh its real owning directory, including aggregate membership.
Path containment checks operate on complete path segments. Both scanners retain
nonzero apparent size for zero-allocation sparse files and overflow samples.

Native cancellation can reject promptly for UI responsiveness, while worker
ownership continues until the sidecar is reaped and the worker exits. Quit
prevents new scan requests, aborts active requests, stops snapshot watchers and
awaits native worker cleanup before retrying application exit. Replaced IPC
requests cannot publish progress, grant delete authority or stop a newer owner.

See [dependency security](dependency-security.md) for the current scoped advisory
assessment and the remaining build-only dependency risk.
