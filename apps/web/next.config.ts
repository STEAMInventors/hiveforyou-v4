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
    "/api/internal/workflow": ["../../prompts/**/*"],
  },
  eslint: {
    dirs: ["src"],
  },
  webpack(config, { isServer }) {
    // Serve pdf.js worker from our own build output (no unpkg/jsdelivr at runtime).
    if (!isServer) {
      config.module.rules.unshift({
        test: /[\\/]node_modules[\\/]pdfjs-dist[\\/]build[\\/]pdf\.worker\.min\.mjs$/,
        type: "asset/resource",
        generator: { filename: "static/worker/[hash][ext]" },
      });
    }
    config.resolve.alias = {
      ...config.resolve.alias,
      ...(!isServer ? { canvas: false } : {}),
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
