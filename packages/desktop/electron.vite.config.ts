import { fileURLToPath } from "node:url"
import { defineConfig } from "electron-vite"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { resolveDesktopChannel, resolvePublicReleaseRepository } from "./src/main/product-identity"

const packagedSmoke = process.env.DISKLIZARD_PACKAGED_SMOKE === "1"
const channel = packagedSmoke
  ? "dev"
  : resolveDesktopChannel(process.env.DISKLIZARD_CHANNEL, process.env.OPENCODE_CHANNEL)
const releaseRepository = packagedSmoke ? undefined : resolvePublicReleaseRepository(process.env)

export default defineConfig({
  main: {
    define: {
      "import.meta.env.DISKLIZARD_CHANNEL": JSON.stringify(channel),
      "import.meta.env.OPENCODE_CHANNEL": JSON.stringify(channel),
      "import.meta.env.DISKLIZARD_RELEASE_OWNER": JSON.stringify(releaseRepository?.owner ?? ""),
      "import.meta.env.DISKLIZARD_RELEASE_REPO": JSON.stringify(releaseRepository?.repo ?? ""),
      "import.meta.env.DISKLIZARD_RELEASE_PUBLIC": JSON.stringify(releaseRepository ? "true" : ""),
      "import.meta.env.DISKLIZARD_PACKAGED_SMOKE": JSON.stringify(packagedSmoke ? "1" : ""),
    },
    build: {
      rollupOptions: {
        // The parser is a Node worker_threads entry, not a browser Worker.
        // Emit it explicitly so packaged builds never depend on a source .ts file.
        input: {
          index: "src/main/index.ts",
          "native-parse-worker": "../disklizard/src/native-parse-worker.ts",
        },
        output: {
          banner: `
// -- CommonJS Shims --
import __cjs_mod__ from 'node:module';
const __filename = import.meta.filename;
const __dirname = import.meta.dirname;
const require = __cjs_mod__.createRequire(import.meta.url);
`,
        },
      },
      externalizeDeps: { exclude: ["@disklizard/app", "@disklizard/core"] },
    },
  },
  preload: {
    build: {
      externalizeDeps: { exclude: ["@disklizard/app"] },
      rollupOptions: {
        input: { index: "src/preload/index.ts" },
        output: {
          format: "cjs",
          entryFileNames: "[name].js",
        },
      },
    },
  },
  renderer: {
    plugins: [tailwindcss(), react()],
    publicDir: fileURLToPath(new URL("../app/public", import.meta.url)),
    resolve: { alias: { "@": fileURLToPath(new URL("../app/src", import.meta.url)) } },
    root: "src/renderer",
    build: {
      sourcemap: true,
      rollupOptions: {
        input: {
          main: "src/renderer/index.html",
        },
      },
    },
  },
})
