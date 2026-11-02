import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.join(currentDir, "../..");

const nextConfig: NextConfig = {
  transpilePackages: ["@hiveforyou/contracts"],
  outputFileTracingRoot: workspaceRoot,
  outputFileTracingIncludes: {
    "/api/v1/hives/[hiveId]/study-preparation": ["../../prompts/**/*"],
  },
  eslint: {
    dirs: ["src"],
  },
  webpack(config) {
    config.resolve.alias = {
      ...config.resolve.alias,
      "server-only": path.join(currentDir, "src/lib/server/server-only.ts"),
    };
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
