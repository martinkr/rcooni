import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // API and E2E tests spawn the server as a subprocess and, in one case, restart it —
    // give those room. Unit tests finish well inside this.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
