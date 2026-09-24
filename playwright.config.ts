import { defineConfig } from "@playwright/test";

/**
 * End-to-end check of the definition of done: two separate browser sessions, a 25 PC table,
 * pot lock, a match, payout, and ledger history after refresh. Expects `pnpm dev` to be running.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 180_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.LOBBY_URL ?? "http://localhost:3000",
    viewport: { width: 1100, height: 760 },
    launchOptions: {
      ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
      args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
    },
  },
});
