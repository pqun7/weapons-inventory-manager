import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { visualizer } from "rollup-plugin-visualizer";
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), visualizer({
    open: true,
    gzipSize: true,
    brotliSize: true,
  }),
  ],
  base: "./",
  resolve: {
    alias: [
      { find: /^lucide-react$/, replacement: path.resolve(__dirname, "./src/lib/lucide-icons.tsx") },
      { find: "@", replacement: path.resolve(__dirname, "./src") },
    ],
  },
  build: {
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return undefined
          }

          if (id.includes("react") || id.includes("react-dom")) {
            return "react-vendor"
          }

          if (id.includes("recharts") || id.includes("d3-")) {
            return "charts-vendor"
          }

          if (id.includes("xlsx")) {
            return "xlsx-vendor"
          }

          if (
            id.includes("@fontsource-variable") ||
            id.includes("lucide-react") ||
            id.includes("radix-ui") ||
            id.includes("sonner") ||
            id.includes("cmdk") ||
            id.includes("vaul") ||
            id.includes("react-hook-form") ||
            id.includes("@hookform/resolvers") ||
            id.includes("zod") ||
            id.includes("zustand") ||
            id.includes("decimal.js") ||
            id.includes("date-fns") ||
            id.includes("clsx") ||
            id.includes("tailwind-merge")
          ) {
            return "ui-vendor"
          }

          return "vendor"
        },
      },
    },
  },
})
