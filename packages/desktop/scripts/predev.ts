import { $ } from "bun"
import { downloadCliToResources, prepareServerBundle } from "./utils"

await $`bun run install-electron`

await $`bun ./scripts/copy-icons.ts ${process.env.DISKLIZARD_CHANNEL ?? process.env.OPENCODE_CHANNEL ?? "dev"}`
await $`bun ../disklizard/scripts/build-native.ts`

await prepareServerBundle()
await downloadCliToResources()
