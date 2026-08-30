import { $ } from "bun"
import { resolveChannel } from "./utils"

await $`bun run install-electron`

await $`bun ./scripts/copy-icons.ts ${resolveChannel()}`
await $`bun ../disklizard/scripts/build-native.ts`
