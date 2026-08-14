import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
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
      thresholds: {
        statements: 55,
        branches: 50,
        functions: 50,
        lines: 60,
      },
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
