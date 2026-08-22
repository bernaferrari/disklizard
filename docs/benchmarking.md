# Benchmarking DiskLizard

DiskLizard does not claim a universal scan-speed ranking. Filesystem traversal is shaped by the storage device, cache state, filesystem, permissions, and directory layout. Publish results with the environment and corpus below so they can be reproduced and compared honestly.

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
