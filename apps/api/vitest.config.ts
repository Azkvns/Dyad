import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    sequence: { concurrent: false },
    globalSetup: ["./test/global-setup.ts"],
    setupFiles: ["./test/load-env.ts"],
    hookTimeout: 30_000,
    testTimeout: 20_000,
    env: { NODE_ENV: "test" },
    server: { deps: { inline: ["contracts"] } },
  },
});
