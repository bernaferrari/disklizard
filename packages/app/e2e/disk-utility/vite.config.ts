import { defineConfig } from "vite"
import desktopPlugin from "../../vite.js"

export default defineConfig({
  root: import.meta.dirname,
  plugins: desktopPlugin,
})
