# Dependency security

The active workspace dependency graph was checked with `bun audit --json` on
2026-10-15. The update removes the unused `shadcn` generator dependency (the
checked-in UI components remain), and updates compatible dependency overrides
including YAML parsing, URL parsing, glob expansion, HTTP caching, source maps,
IP parsing and HTTP transport. The resulting audit has no high or critical
advisories.

One moderate advisory remains: [sprintf-js unbounded precision](https://github.com/advisories/GHSA-hp3w-g68c-fv3c).
The registry has no patched release in the installed major. It is present through
`app-builder-lib -> @electron/get -> global-agent -> roarr -> sprintf-js`, an
optional development/build dependency chain. It is not an application runtime
dependency. Its format strings in that chain belong to the logging code, rather
than being a renderer or network input contract. No vulnerable format-string
input path has been identified in DiskLizard.

This is a scoped residual risk, not an audit suppression. Keep it visible in
`bun audit`; update or remove the chain when a compatible fix becomes available.
Recheck dependency reachability if build tooling, proxy handling or logging
changes. Do not upgrade unrelated major versions solely to make the audit count
zero without verifying their consumers.
