import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Colyseus talks to process.send when it exists (pm2 integration); worker threads have none.
    pool: "threads",
    fileParallelism: false,
    testTimeout: 20000,
  },
});
