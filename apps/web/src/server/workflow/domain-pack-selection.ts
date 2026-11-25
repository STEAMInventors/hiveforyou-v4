/**
 * Trusted per-Hive Domain Pack selection for Rebuild Study.
 * The only selectable edition is the shipped iep-us-federal 0.4.0 source,
 * and only when the stored digest equals that source compiled in this process.
 * Legacy checklist selection stays on hive.hives.pack_id / pack_version.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  type DomainPackSource,
  type InvestigationEnginePin,
  prepareInvestigationStudy,
} from "@hiveforyou/contracts";

export const PINNED_DOMAIN_PACK = {
  packId: "iep-us-federal",
  version: "0.4.0",
} as const;

const SOURCE_FILE = "iep-domain-pack-source.v0.4.0.json";
const ARTIFACT_FILES = {
  ontology: "iep-domain-ontology-spec.json",
  authorityRegister: "iep-domain-authority-register.json",
  conflictPatterns: "iep-domain-conflict-patterns.v1.json",
  stateOverlays: "iep-domain-state-overlays.v1.json",
  factClasses: "iep-domain-fact-classes.v1.json",
  workflowCoverage: "iep-domain-workflow-coverage.v1.json",
  unsupportedOperators: "iep-domain-unsupported-operators.v1.json",
} as const;

export type DomainPackSelection = {
  readonly packId: string;
  readonly version: string;
  readonly compiledDigest: string;
};

export type PinnedDomainPack = {
  readonly source: DomainPackSource;
  readonly artifacts: InvestigationEnginePin["artifacts"];
  readonly compiledDigest: string;
};

type SelectionClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};

export type DomainPackSelectionRead =
  | { readonly status: "none" }
  | { readonly status: "selected"; readonly selection: DomainPackSelection }
  | { readonly status: "unavailable" }
  | { readonly status: "error"; readonly message: string };

let cached: PinnedDomainPack | null = null;

function packDirectory(cwd: string): string {
  const relative = path.join("packs", "drafts", "iep-us-federal", "v0.4.0");
  const candidates = [path.join(cwd, relative), path.join(cwd, "..", "..", relative), path.join(cwd, "..", "..", "..", relative)];
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, SOURCE_FILE))) return candidate;
  }
  throw new Error("pinned_domain_pack_missing");
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8")) as unknown;
}

/** Compiles the shipped source. The digest is the compiler output, not a stored copy. */
export function loadPinnedDomainPack(cwd: string = process.cwd()): PinnedDomainPack {
  if (cached) return cached;
  const root = packDirectory(cwd);
  const source = readJson(path.join(root, SOURCE_FILE)) as DomainPackSource;
  const artifacts = {
    ontology: readJson(path.join(root, ARTIFACT_FILES.ontology)),
    authorityRegister: readJson(path.join(root, ARTIFACT_FILES.authorityRegister)),
    conflictPatterns: readJson(path.join(root, ARTIFACT_FILES.conflictPatterns)),
    stateOverlays: readJson(path.join(root, ARTIFACT_FILES.stateOverlays)),
    factClasses: readJson(path.join(root, ARTIFACT_FILES.factClasses)),
    workflowCoverage: readJson(path.join(root, ARTIFACT_FILES.workflowCoverage)),
    unsupportedOperators: readJson(path.join(root, ARTIFACT_FILES.unsupportedOperators)),
  } satisfies InvestigationEnginePin["artifacts"];
  const prepared = prepareInvestigationStudy({ packSource: source, artifacts });
  if (!prepared.ok) throw new Error("pinned_domain_pack_invalid");
  const identity = prepared.prepared.pack.identity;
  if (identity.packId !== PINNED_DOMAIN_PACK.packId || identity.version !== PINNED_DOMAIN_PACK.version || !identity.digest) {
    throw new Error("pinned_domain_pack_invalid");
  }
  cached = { source, artifacts, compiledDigest: identity.digest };
  return cached;
}

function selectionRpcMissing(message: string): boolean {
  const text = message.toLowerCase();
  return (
    text.includes("get_domain_pack_selection") &&
    (text.includes("does not exist") ||
      text.includes("could not find") ||
      text.includes("schema cache") ||
      text.includes("undefined function"))
  );
}

function readSelection(data: unknown): DomainPackSelection | null {
  const row = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
  if (!row) return null;
  const packId = typeof row.packId === "string" ? row.packId : "";
  const version = typeof row.version === "string" ? row.version : "";
  const compiledDigest = typeof row.compiledDigest === "string" ? row.compiledDigest : "";
  if (!packId || !version || !compiledDigest) return null;
  return { packId, version, compiledDigest };
}

/**
 * Reads the durable selection. A missing RPC means the selection table is not installed,
 * so every Hive stays on the legacy canonicalize path.
 */
export async function readDomainPackSelection(client: SelectionClient, hiveId: string): Promise<DomainPackSelectionRead> {
  const { data, error } = await client.rpc("get_domain_pack_selection", { p_hive_id: hiveId });
  if (error) {
    const message = error.message ?? "rpc_failed";
    if (selectionRpcMissing(message)) return { status: "unavailable" };
    return { status: "error", message };
  }
  const selection = readSelection(data);
  return selection ? { status: "selected", selection } : { status: "none" };
}
