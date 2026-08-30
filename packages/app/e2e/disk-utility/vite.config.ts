import { defineConfig } from "vite"
import diskLizardAppPlugin, { diskLizardPublicDir } from "@disklizard/app/vite"

export default defineConfig({
  root: import.meta.dirname,
  publicDir: diskLizardPublicDir,
  plugins: [diskLizardAppPlugin],
})
