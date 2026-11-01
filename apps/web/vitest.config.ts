import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@v3-auth": path.resolve(__dirname, "../../../hiveforyou-v3/apps/web/src/lib/auth"),
      "@hives/contracts": path.resolve(__dirname, "../../../hiveforyou/packages/contracts/src/index.ts"),
      "@hives/core": path.resolve(__dirname, "../../../hiveforyou/packages/core/src/index.ts"),
      "@hives/security": path.resolve(__dirname, "../../../hiveforyou/packages/security/src/index.ts"),
      "@hives/persistence/vault": path.resolve(__dirname, "../../../hiveforyou/packages/persistence/src/vault"),
      "@hives/persistence/storage": path.resolve(__dirname, "../../../hiveforyou/packages/persistence/src/storage"),
      "@hives/persistence/env": path.resolve(__dirname, "../../../hiveforyou/packages/persistence/src/env.ts"),
    },
  },
});
