# Benchmarking DiskLizard

DiskLizard does not claim a universal scan-speed ranking. Filesystem traversal is shaped by the storage device, cache state, filesystem, permissions, and directory layout. Publish results with the environment and corpus below so they can be reproduced and compared honestly.

## Renderer interactions

Run `bun run --cwd packages/app benchmark:disk-ui` to measure the production
browser fixture in five isolated contexts, serially. The report is saved to
`test-results/disk-ui-benchmark.json`. It records time from page navigation to a
usable scan, switching to Tiles, and opening Clean up, including Playwright
action and assertion overhead. Reduced motion is enabled for repeatability.
These measurements characterize the renderer and fixture, not native scanner
throughput. They assert completion without machine-dependent speed thresholds.
Run before and after a change with other builds and tests stopped.

## Command

Run one explicit, read-only measurement against a prepared corpus:

```bash
bun run --cwd packages/desktop benchmark:disk -- --path /absolute/path/to/corpus
```

Record the reported backend (`native` or `typescript-fallback`), elapsed time, entry count, bytes, and throughput. Run the command after a reboot or cache-clearing procedure for a cold result, then repeat it at least three times for warm-cache results. Do not average native and fallback runs together.

## Required corpus coverage

Every published benchmark set should include these independently named corpora:

| Corpus | What it proves |
| --- | --- |
| `tiny-files` | One million small files; metadata traversal and peak memory pressure |
| `wide-directory` | At least 100,000 siblings; bounded child materialization |
| `deep-paths` | Deep nesting and long paths; path handling and cancellation |
| `hard-links` | Groups wholly and partially inside the scan root; accounting boundaries |
| `clones` | APFS clone groups wholly and partially inside the scan root when available |
| `permissions` | Unreadable descendants; incomplete-scope reporting |
| `links-and-mounts` | Symlink cycles and nested-device boundaries; traversal safety |
| `mutation` | Files added, removed, and renamed during a scan; cancellation and settling |

Generated corpora must be stored outside the repository and their generator version, filesystem format, storage medium, and available free space must be recorded with the result.

## Metrics to publish

Report the median and range for at least three warm runs and at least one cold run:

- time to first usable visualization;
- time to exact totals;
- entries per second;
- peak scanner and desktop resident memory;
- serialized result payload size;
- cancellation latency;
- snapshot reload latency; and
- delta-rescan latency after a small change.

For every accounting corpus, report expected versus observed physical and logical totals, and explicitly mark unavailable clone evidence as unavailable rather than zero. Benchmark tables must identify the operating system, CPU, RAM, storage model, filesystem, DiskLizard commit, Rust version, Bun version, and whether Full Disk Access or equivalent permissions were granted.

## Correctness hardening verification (2026-10-15)

The production fixture was measured before and after the snapshot, scan ownership
and cleanup hardening. Each run uses five fresh browser contexts; numbers below
are median action/assertion wall-clock milliseconds.

| Measurement | Before | After | Same-build repeat |
| --- | ---: | ---: | ---: |
| Scan to usable | 433.43 | 893.59 | 1345.25 |
| Tiles ready | 60.02 | 170.31 | 243.11 |
| Cleanup ready | 62.77 | 124.22 | 330.74 |

Both after runs completed without browser errors. The shared host had heavy
unrelated Rust, Kotlin and JavaScript builds running (load averages around 58,
70 and 85 were observed after the first after run). The timings are slower and
highly variable. This does not establish whether the change introduced a
performance regression; it also does not support a performance improvement
claim. Re-measure on an idle host before treating these values as release
performance evidence. Raw local reports are in `test-results/disk-ui-85-*.json`.

The same source passed 875 canonical tests, 55 Rust tests, three production
browser journeys, workspace type checks and lint. The unsigned macOS ARM64
packaged journey passed native scanning, snapshot restoration, text/PDF previews,
CSP checks, updater metadata and actual fixture Trash removal. Windows and Linux
packaged execution was not verified on this host.
