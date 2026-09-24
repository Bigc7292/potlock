import { defineConfig } from "vite";

export default defineConfig({
  // Read VITE_* variables from the repo root .env.
  envDir: "../../",
  server: { port: 5173, strictPort: true },
});
