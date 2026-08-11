import { defineConfig, loadEnv } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";
import path from "node:path";

const { publicVars } = loadEnv({ prefixes: ["VITE_"] });
const isDevelopment = process.env.NODE_ENV === "development";

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
        define: publicVars,
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
        // A root URL is required for dev-server HMR chunks. The relative path is
        // retained for the packaged Electron application, which loads index.html
        // through the file protocol.
        assetPrefix: isDevelopment ? "/" : "./",
    },
});
