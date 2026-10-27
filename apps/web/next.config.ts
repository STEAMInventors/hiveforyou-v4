import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const workspaceRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

const nextConfig: NextConfig = {
  transpilePackages: ["@hiveforyou/contracts"],
  outputFileTracingRoot: workspaceRoot,
  eslint: {
    dirs: ["src"],
  },
};

export default nextConfig;
