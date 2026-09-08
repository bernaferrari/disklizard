# DiskLizard renderer

The main DiskLizard interface uses React 19, Base UI/shadcn components, Tailwind CSS v4, Framer Motion, and virtualized storage lists.

Run `bun run dev:desktop` from the repository root for the native app. Electron supplies real storage data through its preload bridge; `bun run --cwd packages/app dev` runs the standalone browser demo.

Use `bun run --cwd packages/app typecheck` and `bun run --cwd packages/app test` to validate the renderer. Canvas transitions cache geometry before animation, and scan percentages come from the native scanner and snapshot pipeline.
