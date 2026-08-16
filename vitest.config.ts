import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@electron": path.resolve(import.meta.dirname, "electron"),
    },
  },

  test: {
    globals: true,
    environment: "jsdom",

    setupFiles: ["./tests/setup.ts"],

    include: ["tests/unit/**/*.test.{ts,tsx}"],

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
        statements: 58,
        branches: 50,
        functions: 50,
        lines: 63,
      },
      exclude: [
        "node_modules/**",
        "dist/**",
        "dist-electron/**",
        "tests/**",
        "**/*.config.*",
        "**/*.d.ts",
      ],
    },
  },
});
