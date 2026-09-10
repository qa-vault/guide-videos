import { defineConfig } from "vitest/config";

// Unit suites: pure modules, network intercepted, filesystem in temp dirs. `npm test`.
export default defineConfig({
  test: {
    include: ["test/*.test.mjs"],
    testTimeout: 20000,
  },
});
