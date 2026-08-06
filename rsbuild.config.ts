import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";
import path from "node:path";

export default defineConfig({
    plugins: [
        pluginReact(),
    ],

    tools: {
        postcss: {
            postcssOptions: {
                plugins: [
                    require('@tailwindcss/postcss'),
                ],
            },
        },
    },

    resolve: {
        alias: {
            "@": path.resolve(__dirname, "src"),
        },
    },

    source: {
        entry: {
            index: "./src/main.tsx",
        },
    },

    html: {
        template: "./index.html",
    },

    output: {
        distPath: {
            root: "dist",
        },
        assetPrefix: "./",
    },
});