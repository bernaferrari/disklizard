# Startup disk progress investigation — 2026-09-08

The previous native estimator split a fixed work budget equally among sibling
subdirectories. Empty or tiny root directories therefore completed as much of
the budget as large subtrees. Removing symlinks from that division did not fix
the underlying assumption.

A direct Rust startup-disk probe reproduced 42.857% after only 38 files and 10
directories (0.16 seconds). At 12.06 seconds it reported 86.2%, despite having
processed only 838,908 files and 197,955 directories.

## Change

For mounted APFS/HFS volumes, `volume_progress.rs` obtains the allocated object
count from `statfs` (`f_files - f_ffree`) before traversal. The startup namespace
includes both the system volume and the Data volume exposed through firmlinks.
Mount sources distinguish these volumes: `st_dev` is synthesized and was equal
for both on the test Mac. The duplicate Data mount remains excluded from the
walk; no accounting or traversal exclusions were removed.

Progress uses visited file/directory counts divided by the initial volume
object count. Concurrent changes, skipped symlinks, unreadable locations and
excluded subtrees mean this is a coverage estimate, not an exact remaining-time
prediction. Only successful completion emits 100%. Arbitrary directories and
unsupported filesystems still use the existing traversal estimate; this change
does not claim to solve that fallback.

## Measurements

The corrected startup probe's first completed branch reported 0.00046%, and it
reached 4.37% at 3.05 seconds (481,195 files and 80,718 directories).

A full direct Rust run, physical accounting, depth 6, 64 retained children,
without developer inventory:

| Elapsed | Native progress |
| --- | --- |
| 10.5 s | 14.9% |
| 21.0 s | 28.8% |
| 41.5 s | 50.9% |
| 62.5 s | 74.8% |
| 95.3 s | 97.8% |
| 118.0 s | Complete |

Final counts: 10,891,681 files and 1,681,797 directories. Serialized result:
16,963,811 bytes; completion event to serialized result took about 0.06 seconds.
These are local measurements on a changing filesystem, not comparative
benchmarks against DaisyDisk or a claimed speedup.

A three-second macOS sampling profile of early traversal attributed 19,015
leaf samples to `getattrlistbulk` and 5,250 to `openat`, compared with 13 mutex-wait
samples. Thread samples include concurrent kernel waits and must not be read as
wall-clock percentages. The early bottleneck is filesystem metadata I/O, not
React or a contended Rust mutex. The final slow directories need separate tail
profiling; the first profile does not establish their cause.

## Validation

`cargo test --manifest-path packages/disklizard/native-scanner/Cargo.toml`:
49 passing tests, including initial progress, startup Data inclusion, non-mount
fallback, and concurrent-growth completion bounds. The release scanner was
rebuilt and used for the real-disk probes above.

## Second full run

A subsequent direct Rust run enabled the app's preserve/collapse/signature
lists and its 2,000-item developer inventory. It completed in 88.91 seconds,
with 10,877,972 files, 1,679,461 directories and a 17,528,525-byte result. It
reported 13.4% at 10.5 seconds, 56.6% at 51.5 seconds and 89.3% at 81.5 seconds.
The earlier long tail did not recur. A profile triggered above 96% caught brief
hard-link accounting and serialization, not a long computation. This does not
identify the exact directory responsible for the first run's tail. Filesystem
cache state and concurrent filesystem changes prevent treating the two runs
as an inventory-overhead or speedup comparison.

No traversal data, permissions, clone accounting or developer inventory was
removed to obtain the corrected progress. This is not evidence of performance
parity with another application. A controlled end-to-end comparison must use
the same readable scope and comparable cache conditions.
