# DiskLizard Desktop (OpenCode shell)

DaisyDisk-style disk visualizer built on the OpenCode Electron desktop shell,
reusing `@opencode-ai/ui` themes (OC-2), window chrome, IPC, and preload.

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
