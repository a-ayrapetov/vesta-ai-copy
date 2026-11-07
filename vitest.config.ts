import { defineConfig } from "vitest/config";
import path from "path";

// Separate from vite.config.ts so the client build plugins never load in tests.
export default defineConfig({
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "shared"),
      "@": path.resolve(__dirname, "client", "src"),
    },
  },
  test: {
    environment: "node",
    include: ["server/**/*.test.ts", "shared/**/*.test.ts"],
    setupFiles: ["dotenv/config"],
    // Integration tests share one Postgres database; run files one at a time.
    fileParallelism: false,
  },
});
