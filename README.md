<p align="center">
  <img src="packages/desktop/icons/source/disklizard-master.png" width="128" height="128" alt="DiskLizard icon">
</p>

<h1 align="center">DiskLizard</h1>
<p align="center">See what's using your disk. Review what can go.</p>

DiskLizard is a desktop disk explorer for macOS, Windows, and Linux. Scan a drive or folder, browse its contents as a map, tiles, or layers, and find large files and developer artifacts such as dependencies, build output, and caches. Cleanup is a separate review step that moves approved items to Trash or Recycle Bin.

> DiskLizard is under active development. Packaged releases are not available yet; the first public beta will be in English.

## Run locally

You need [Bun](https://bun.sh/) 1.3+, a [Rust toolchain](https://rustup.rs/), and your platform's native build tools.

```bash
git clone https://github.com/bernaferrari/disklizard.git
cd disklizard
bun install
bun dev:desktop
```

The first launch builds the native scanner and takes longer. For a read-only terminal report:

```bash
bun disklizard ~/Projects --summary
bun disklizard ~/Projects --json --max-depth 6
```

## Build and test

```bash
bun run --cwd packages/desktop build
bun run typecheck
bun run lint
bun run test:disklizard
```

To package the app, run `package:mac`, `package:win`, or `package:linux` from `packages/desktop` on the corresponding platform. Artifacts go to `packages/desktop/dist`.

## Cleanup safety

Scanning reads filesystem metadata without changing files. DiskLizard keeps ambiguous developer folders in review, protects system and project-management data, and rechecks paths before moving anything to Trash or Recycle Bin. Reported size is measured disk usage, not a promise of space reclaimed: hard links and filesystem clones can share storage. Unreadable locations are reported as incomplete coverage.

## License

[MIT](LICENSE)
