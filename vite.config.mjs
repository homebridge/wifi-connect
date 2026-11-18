import { fileURLToPath } from "node:url";

import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

// Builds the setup page from ./source into ./interface, which the server serves as static files.
export default defineConfig({
    plugins: [vue()],
    resolve: {
        alias: {
            "@": fileURLToPath(new URL("./source", import.meta.url)),
        },
    },
    build: {
        outDir: "interface",
        emptyOutDir: true,
    },
});
