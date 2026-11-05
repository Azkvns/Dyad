import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      contracts: fileURLToPath(new URL("../../packages/contracts/src/index.ts", import.meta.url)),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api": { target: "http://127.0.0.1:3000", changeOrigin: true },
      "/ws": { target: "http://127.0.0.1:3000", ws: true },
    },
  },
  test: {
    environment: "jsdom",
    fileParallelism: false,
    globals: true,
  },
});
