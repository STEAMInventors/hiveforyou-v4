import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "../../eval/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@hiveforyou/contracts": path.resolve(__dirname, "src/index.ts"),
    },
  },
});
