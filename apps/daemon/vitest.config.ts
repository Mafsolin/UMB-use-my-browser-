import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@umb/core": path.resolve(import.meta.dirname, "../../packages/core/src/index.ts"),
      "@umb/protocol": path.resolve(import.meta.dirname, "../../packages/protocol/src/index.ts")
    }
  },
  test: {
    environment: "node"
  }
});
