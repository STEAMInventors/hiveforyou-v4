import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.join(currentDir, "../..");
const require = createRequire(import.meta.url);

/** react-pdf bundles pdfjs-dist; webpack must not resolve a separate hoisted copy. */
const reactPdfPdfjsDistRoot = path.dirname(
  require.resolve("pdfjs-dist/package.json", { paths: [require.resolve("react-pdf")] }),
);

const PACK_TRACE_GLOBS = ["../../packs/*.md", "../../packs/archive/*.md"] as const;

const nextConfig: NextConfig = {
  transpilePackages: ["@hiveforyou/contracts"],
  outputFileTracingRoot: workspaceRoot,
  outputFileTracingIncludes: {
    "/hives/[hiveId]/study": ["../../prompts/**/*", ...PACK_TRACE_GLOBS],
    "/hives/[hiveId]/reports": ["../../prompts/**/*", ...PACK_TRACE_GLOBS],
    "/hives/[hiveId]/documents": ["../../prompts/**/*", ...PACK_TRACE_GLOBS],
    "/hives": ["../../prompts/**/*", ...PACK_TRACE_GLOBS],
    "/api/v1/hives/[hiveId]/reports": ["../../prompts/**/*", ...PACK_TRACE_GLOBS],
    "/api/v1/hives/[hiveId]/study-preparation": ["../../prompts/**/*", ...PACK_TRACE_GLOBS],
    "/api/v1/hives/[hiveId]/study-preparation/rebuild": ["../../prompts/**/*", ...PACK_TRACE_GLOBS],
    "/api/internal/workflow": ["../../prompts/**/*", ...PACK_TRACE_GLOBS],
    "/api/internal/workflow-recovery": ["../../prompts/**/*", ...PACK_TRACE_GLOBS],
  },
  eslint: {
    dirs: ["src"],
  },
  webpack(config, { isServer }) {
    config.resolve.alias = {
      ...config.resolve.alias,
      ...(!isServer ? { canvas: false, "pdfjs-dist": reactPdfPdfjsDistRoot } : {}),
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
