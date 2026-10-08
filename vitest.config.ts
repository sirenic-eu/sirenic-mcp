import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // No test opens the network: test/setup-no-network.ts refuses any socket and the global fetch.
    setupFiles: ["test/setup-no-network.ts"],
  },
});
