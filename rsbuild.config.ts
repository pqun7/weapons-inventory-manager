import { defineConfig, loadEnv } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";
import path from "node:path";

const loadedPublicVars = loadEnv({ prefixes: ["VITE_"] }).publicVars;
const genericRelease = process.env.ARMORY_GENERIC_BUILD === "true";
// A public installer must never inherit a developer's .env.local project.
// Local development may still opt into the legacy VITE fallback.
const publicVars = genericRelease
    ? Object.fromEntries(Object.entries(loadedPublicVars).filter(([key]) => !key.includes("SUPABASE")))
    : loadedPublicVars;
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
