import { defineConfig } from "vitest/config";

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) throw new Error("TEST_DATABASE_URL is not set (see .env.example)");

export default defineConfig({
  test: {
    globalSetup: "./test/globalSetup.ts",
    // The ledger tests talk to a dedicated Postgres database, never the dev one.
    env: { DATABASE_URL: testUrl },
    fileParallelism: false,
    testTimeout: 20000,
  },
});
