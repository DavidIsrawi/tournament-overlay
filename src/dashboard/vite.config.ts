import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const directory = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: directory,
  plugins: [react()],
  build: {
    outDir: resolve(directory, "../../dist/public"),
    emptyOutDir: false,
    assetsDir: "assets/dashboard",
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:3100",
      "/ws": {
        target: "ws://127.0.0.1:3100",
        ws: true,
      },
    },
  },
});
