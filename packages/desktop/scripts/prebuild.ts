#!/usr/bin/env bun
import { $ } from "bun"

import { downloadCliToResources, prepareServerBundle, resolveChannel } from "./utils"

const channel = resolveChannel()
await $`bun ./scripts/copy-icons.ts ${channel}`
await $`bun ./scripts/copy-metainfo.ts ${channel}`
await $`bun ../disklizard/scripts/build-native.ts`

await prepareServerBundle()
if (channel === "dev") await downloadCliToResources()
