import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@hives/contracts": path.resolve(
        __dirname,
        "./src/server/source-documents/v3-vault/contracts/index.ts",
      ),
      "@hives/core": path.resolve(
        __dirname,
        "./src/server/source-documents/v3-vault/core/index.ts",
      ),
      "@hives/security": path.resolve(
        __dirname,
        "./src/server/source-documents/v3-vault/security/index.ts",
      ),
      "@hives/persistence/vault": path.resolve(
        __dirname,
        "./src/server/source-documents/v3-vault/persistence/vault",
      ),
      "@hives/persistence/storage": path.resolve(
        __dirname,
        "./src/server/source-documents/v3-vault/persistence/storage",
      ),
      "@hives/persistence/env": path.resolve(
        __dirname,
        "./src/server/source-documents/v3-vault/persistence/env.ts",
      ),
      "server-only": path.resolve(__dirname, "./src/lib/server/server-only.ts"),
    },
  },
});
