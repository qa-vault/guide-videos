import { defineConfig } from "vitest/config";

// The whole pipeline against the bundled mock app: real Chromium, real ffmpeg, port 3000.
// `npm run test:integration`; takes about two minutes.
export default defineConfig({
  test: {
    include: ["test/integration/*.test.mjs"],
    testTimeout: 300000,
    hookTimeout: 60000,
    fileParallelism: false,
  },
});
