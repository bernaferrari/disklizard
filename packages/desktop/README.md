# DiskLizard Desktop

The Electron desktop host for DiskLizard's storage map, developer-artifact
inventory, and review-first cleanup flow.

## Development

From repo root:

```bash
bun install
bun dev:desktop
```

Or from this package:

```bash
bun install
bun dev
```

Windows package:

```bash
bun run build && bun run package:win
```

## Build

Run the `build` script to build the app's JS assets, then `package` to
bundle the assets as an application. The resulting app will be in `dist/`.

```bash
bun run build && bun run package
```
