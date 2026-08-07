import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },

  test: {
    globals: true,
    environment: "jsdom",

    setupFiles: ["./src/test/setup.ts"],

    include: ["src/**/*.test.{ts,tsx}"],



    exclude: [
      "node_modules",
      "dist",
      "dist-electron",
      "coverage",
    ],

    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: [
        "node_modules/**",
        "dist/**",
        "dist-electron/**",
        "**/*.config.*",
        "**/*.d.ts",
      ],
    },
  },
});