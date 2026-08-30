import solidPlugin from "vite-plugin-solid"
import tailwindcss from "@tailwindcss/vite"
import { fileURLToPath } from "node:url"

// The legacy app public directory also contains OpenCode web favicons, social
// cards, and manifests. DiskLizard owns a deliberately tiny public surface;
// its fonts are resolved through CSS and emitted as hashed build assets.
export const diskLizardPublicDir = fileURLToPath(new URL("./disklizard-public", import.meta.url))

export function resolveDiskLizardViteChannel(diskLizardChannel, legacyChannel) {
  const raw = diskLizardChannel ?? legacyChannel
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  return "dev"
}

const channel = resolveDiskLizardViteChannel(process.env.DISKLIZARD_CHANNEL, process.env.OPENCODE_CHANNEL)

/**
 * @type {import("vite").PluginOption}
 */
export default [
  {
    name: "disklizard-app:config",
    config() {
      return {
        resolve: {
          alias: {
            "@": fileURLToPath(new URL("./src", import.meta.url)),
          },
        },
        define: {
          "import.meta.env.DISKLIZARD_CHANNEL": JSON.stringify(channel),
        },
        worker: {
          format: "es",
        },
      }
    },
  },
  tailwindcss(),
  solidPlugin(),
]
