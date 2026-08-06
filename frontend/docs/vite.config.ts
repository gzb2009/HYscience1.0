import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

// Served under hyscience.sh/docs, so every asset URL resolves beneath /docs/.
export default defineConfig({
  base: "/docs/",
  plugins: [react()],
  assetsInclude: ["**/*.mdx"],
})
