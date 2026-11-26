/**
 * Published Domain Pack editions for Rebuild Study.
 * The catalog names which editions are published and approved.
 * Applicability hints come from each edition's own source.
 * A stored per-Hive row is optional. Legacy checklist selection stays on hive.hives.pack_id / pack_version.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  PUBLISHED_DOMAIN_PACK_CATALOG_SCHEMA,
  selectPublishedDomainPack,
  type DomainPackSource,
  type HiveDomainText,
  type PublishedEditionCandidate,
} from "@hiveforyou/contracts";
import { type InvestigationEnginePin, prepareInvestigationStudy } from "@hiveforyou/contracts/investigation";

import { resolvePacksRoot } from "@/server/pipeline/pack-loader-core";

const CATALOG_FILE = "domain-pack-catalog.json";
const SOURCE_SCHEMA = "hive.domain-pack-source/1";
const RELATIONSHIP_SCHEMA = "hive.relationship-source-structure/1";

const ARTIFACT_SCHEMAS = {
  ontology: "hive.domain-ontology-spec/1",
  authorityRegister: "hive.domain-authority-register/1",
  conflictPatterns: "hive.domain-conflict-pattern-spec/1",
  stateOverlays: "hive.domain-state-overlay-spec/1",
  factClasses: "hive.domain-fact-class-spec/1",
  workflowCoverage: "hive.domain-workflow-coverage-spec/1",
  unsupportedOperators: "hive.domain-unsupported-operator-spec/1",
} as const;

type ArtifactKey = keyof typeof ARTIFACT_SCHEMAS;

export type DomainPackSelection = {
  readonly packId: string;
  readonly version: string;
  readonly compiledDigest: string;
};

export type LoadedPublishedPack = {
  readonly domain: string;
  readonly investigationPromptId: string;
  readonly source: DomainPackSource;
  readonly artifacts: InvestigationEnginePin["artifacts"];
  readonly compiledDigest: string;
  readonly relationshipStructures: readonly unknown[];
  readonly candidate: PublishedEditionCandidate;
};

export type PublishedPackResolution =
  | { readonly status: "none" }
  | { readonly status: "selected"; readonly pack: LoadedPublishedPack }
  | { readonly status: "invalid" };

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

type CatalogEntry = {
  readonly domain: string;
  readonly packId: string;
  readonly version: string;
  readonly publication: string;
  readonly approval: string;
  readonly investigationPromptId: string;
  readonly directory: string;
};

const loaded = new Map<string, LoadedPublishedPack>();

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8")) as unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function schemaMatches(value: unknown, schema: string): boolean {
  return isRecord(value) && text(value.schema).startsWith(schema);
}

function catalogPath(root: string): string {
  return path.join(root, "published", CATALOG_FILE);
}

function readCatalog(root: string): CatalogEntry[] {
  const file = catalogPath(root);
  if (!existsSync(file)) return [];
  const parsed = readJson(file);
  if (!isRecord(parsed) || parsed.schema !== PUBLISHED_DOMAIN_PACK_CATALOG_SCHEMA || !Array.isArray(parsed.editions)) {
    throw new Error("published_domain_pack_catalog_invalid");
  }
  return parsed.editions.map((entry) => {
    if (!isRecord(entry)) throw new Error("published_domain_pack_catalog_invalid");
    const catalogEntry: CatalogEntry = {
      domain: text(entry.domain),
      packId: text(entry.packId),
      version: text(entry.version),
      publication: text(entry.publication),
      approval: text(entry.approval),
      investigationPromptId: text(entry.investigationPromptId),
      directory: text(entry.directory),
    };
    if (
      !catalogEntry.domain ||
      !catalogEntry.packId ||
      !catalogEntry.version ||
      !catalogEntry.publication ||
      !catalogEntry.approval ||
      !catalogEntry.investigationPromptId ||
      !catalogEntry.directory ||
      catalogEntry.directory.includes("..")
    ) {
      throw new Error("published_domain_pack_catalog_invalid");
    }
    return catalogEntry;
  });
}

function jsonFiles(directory: string): { schema: string; value: unknown }[] {
  return readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      const value = readJson(path.join(directory, name));
      return { schema: isRecord(value) ? text(value.schema) : "", value };
    });
}

function findBySchema(files: readonly { schema: string; value: unknown }[], schema: string): unknown {
  const matches = files.filter((file) => file.schema.startsWith(schema));
  if (matches.length !== 1) throw new Error("published_domain_pack_invalid");
  return matches[0]!.value;
}

function relationshipStructures(files: readonly { schema: string; value: unknown }[]): unknown[] {
  const matches = files.filter((file) => {
    if (!Array.isArray(file.value)) return false;
    return file.value.length === 0 || file.value.every((item) => schemaMatches(item, RELATIONSHIP_SCHEMA));
  });
  if (matches.length > 1) throw new Error("published_domain_pack_invalid");
  if (matches.length === 0) return [];
  const parsed = matches[0]!.value;
  return Array.isArray(parsed) ? parsed : [];
}

function candidateFromSource(entry: CatalogEntry, source: DomainPackSource): PublishedEditionCandidate {
  return {
    domain: entry.domain,
    packId: entry.packId,
    version: entry.version,
    publication: entry.publication,
    approval: entry.approval,
    investigationPromptId: entry.investigationPromptId,
    intentHints: source.applicability.intentHints ?? [],
    documentHints: source.applicability.documentHints ?? [],
  };
}

function loadEdition(root: string, entry: CatalogEntry): LoadedPublishedPack {
  const directory = path.join(root, entry.directory);
  const cached = loaded.get(directory);
  if (cached) return cached;
  if (!existsSync(directory)) throw new Error("published_domain_pack_missing");
  const files = jsonFiles(directory);
  const source = findBySchema(files, SOURCE_SCHEMA) as DomainPackSource;
  if (source.identity?.packId !== entry.packId || source.identity?.version !== entry.version) {
    throw new Error("published_domain_pack_invalid");
  }
  const artifacts = {
    ontology: findBySchema(files, ARTIFACT_SCHEMAS.ontology),
    authorityRegister: findBySchema(files, ARTIFACT_SCHEMAS.authorityRegister),
    conflictPatterns: findBySchema(files, ARTIFACT_SCHEMAS.conflictPatterns),
    stateOverlays: findBySchema(files, ARTIFACT_SCHEMAS.stateOverlays),
    factClasses: findBySchema(files, ARTIFACT_SCHEMAS.factClasses),
    workflowCoverage: findBySchema(files, ARTIFACT_SCHEMAS.workflowCoverage),
    unsupportedOperators: findBySchema(files, ARTIFACT_SCHEMAS.unsupportedOperators),
  } satisfies InvestigationEnginePin["artifacts"];
  const prepared = prepareInvestigationStudy({ packSource: source, artifacts });
  if (!prepared.ok) throw new Error("published_domain_pack_invalid");
  const identity = prepared.prepared.pack.identity;
  if (identity.packId !== entry.packId || identity.version !== entry.version || !identity.digest) {
    throw new Error("published_domain_pack_invalid");
  }
  const pack: LoadedPublishedPack = {
    domain: entry.domain,
    investigationPromptId: entry.investigationPromptId,
    source,
    artifacts,
    compiledDigest: identity.digest,
    relationshipStructures: relationshipStructures(files),
    candidate: candidateFromSource(entry, source),
  };
  loaded.set(directory, pack);
  return pack;
}

function packsRoot(cwd: string): string | null {
  return resolvePacksRoot(cwd);
}

/** Approved editions that compile. A listed edition that does not compile is reported separately. */
export function loadApprovedDomainPacks(cwd: string = process.cwd()): {
  packs: LoadedPublishedPack[];
  invalid: boolean;
} {
  const root = packsRoot(cwd);
  if (!root || !existsSync(catalogPath(root))) return { packs: [], invalid: false };
  let entries: CatalogEntry[];
  try {
    entries = readCatalog(root).filter((entry) => entry.publication === "PUBLISHED" && entry.approval === "APPROVED");
  } catch {
    return { packs: [], invalid: true };
  }
  const packs: LoadedPublishedPack[] = [];
  for (const entry of entries) {
    try {
      packs.push(loadEdition(root, entry));
    } catch {
      return { packs, invalid: true };
    }
  }
  return { packs, invalid: false };
}

/**
 * Latest published, approved edition applicable to the Hive text.
 * A published edition that cannot be loaded fails closed for every rebuild,
 * because the workflow cannot prove that edition does not apply.
 */
export function resolvePublishedDomainPack(hive: HiveDomainText, cwd: string = process.cwd()): PublishedPackResolution {
  const root = packsRoot(cwd);
  if (!root || !existsSync(catalogPath(root))) return { status: "none" };
  let entries: CatalogEntry[];
  try {
    entries = readCatalog(root);
  } catch {
    return { status: "invalid" };
  }
  const approved = entries.filter((entry) => entry.publication === "PUBLISHED" && entry.approval === "APPROVED");
  const packs: LoadedPublishedPack[] = [];
  for (const entry of approved) {
    try {
      packs.push(loadEdition(root, entry));
    } catch {
      return { status: "invalid" };
    }
  }
  const selected = selectPublishedDomainPack(
    packs.map((pack) => pack.candidate),
    hive,
  );
  if (selected.status === "none") return { status: "none" };
  const pack = packs.find(
    (item) => item.candidate.packId === selected.edition.packId && item.candidate.version === selected.edition.version,
  );
  return pack ? { status: "selected", pack } : { status: "invalid" };
}

export function loadApprovedEdition(
  packId: string,
  version: string,
  cwd: string = process.cwd(),
): LoadedPublishedPack | null {
  const root = packsRoot(cwd);
  if (!root) return null;
  let entries: CatalogEntry[];
  try {
    entries = readCatalog(root);
  } catch {
    return null;
  }
  const entry = entries.find(
    (item) =>
      item.packId === packId &&
      item.version === version &&
      item.publication === "PUBLISHED" &&
      item.approval === "APPROVED",
  );
  if (!entry) return null;
  try {
    return loadEdition(root, entry);
  } catch {
    return null;
  }
}

function selectionRpcMissing(message: string): boolean {
  const textValue = message.toLowerCase();
  return (
    textValue.includes("get_domain_pack_selection") &&
    (textValue.includes("does not exist") ||
      textValue.includes("could not find") ||
      textValue.includes("schema cache") ||
      textValue.includes("undefined function"))
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
 * Reads a stored selection when the table is installed.
 * A missing RPC means no stored row. It does not by itself choose a pack.
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

export function hiveDomainText(input: {
  intentText?: string;
  fileNames?: readonly string[];
  extractions?: readonly { fileName?: string; document?: { documentType?: string; titleAsPrinted?: string; summary?: string; domain?: { label?: string } } }[];
}): HiveDomainText {
  const documents = [
    ...(input.fileNames ?? []),
    ...(input.extractions ?? []).flatMap((extraction) => [
      extraction.fileName,
      extraction.document?.documentType,
      extraction.document?.titleAsPrinted,
      extraction.document?.summary,
      extraction.document?.domain?.label,
    ]),
  ].filter((value): value is string => typeof value === "string" && value.trim() !== "");
  return { intentText: input.intentText ?? "", documents };
}
