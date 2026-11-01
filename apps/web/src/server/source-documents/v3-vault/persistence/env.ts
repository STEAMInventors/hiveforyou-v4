import {
  DEFAULT_HIVE_DERIVED_BUCKET,
  DEFAULT_HIVE_OUTPUT_BUCKET,
  DEFAULT_HIVE_SOURCE_BUCKET,
} from "./storage/buckets.js";

export type DatabaseEnv = {
  readonly DATABASE_URL: string;
};

export type SupabaseAdminEnv = {
  readonly SUPABASE_URL: string;
  readonly SUPABASE_SECRET_KEY: string;
};

export type VaultRuntimeEnv = SupabaseAdminEnv & {
  readonly HIVE_SOURCE_BUCKET: string;
  readonly HIVE_DERIVED_BUCKET: string;
  readonly HIVE_OUTPUT_BUCKET: string;
};

export type VaultPersistenceEnv = VaultRuntimeEnv;

function required(source: NodeJS.ProcessEnv, key: string): string {
  const value = source[key]?.trim();
  if (value === undefined || value.length === 0) {
    throw new Error(`${key} is required for Hive Vault persistence adapters`);
  }
  return value;
}

function requiredSupabaseSecretKey(source: NodeJS.ProcessEnv): string {
  const preferred = source.SUPABASE_SECRET_KEY?.trim();
  if (preferred !== undefined && preferred.length > 0) {
    return preferred;
  }
  const legacy = source.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (legacy !== undefined && legacy.length > 0) {
    return legacy;
  }
  throw new Error(
    "SUPABASE_SECRET_KEY is required for Hive Vault persistence adapters; SUPABASE_SERVICE_ROLE_KEY is accepted as a legacy fallback",
  );
}

export function loadDatabaseEnv(source: NodeJS.ProcessEnv = process.env): DatabaseEnv {
  return { DATABASE_URL: required(source, "DATABASE_URL") };
}

export function loadSupabaseAdminEnv(source: NodeJS.ProcessEnv = process.env): SupabaseAdminEnv {
  return {
    SUPABASE_URL: required(source, "SUPABASE_URL"),
    SUPABASE_SECRET_KEY: requiredSupabaseSecretKey(source),
  };
}

export function loadVaultRuntimeEnv(
  source: NodeJS.ProcessEnv = process.env,
): VaultRuntimeEnv {
  return {
    ...loadSupabaseAdminEnv(source),
    HIVE_SOURCE_BUCKET: source.HIVE_SOURCE_BUCKET?.trim() || DEFAULT_HIVE_SOURCE_BUCKET,
    HIVE_DERIVED_BUCKET: source.HIVE_DERIVED_BUCKET?.trim() || DEFAULT_HIVE_DERIVED_BUCKET,
    HIVE_OUTPUT_BUCKET: source.HIVE_OUTPUT_BUCKET?.trim() || DEFAULT_HIVE_OUTPUT_BUCKET,
  };
}

export function loadVaultPersistenceEnv(
  source: NodeJS.ProcessEnv = process.env,
): VaultPersistenceEnv {
  return loadVaultRuntimeEnv(source);
}

export const EVIDENCE_PERSISTENCE_MODES = ["supabase", "memory"] as const;
export type EvidencePersistenceMode = (typeof EVIDENCE_PERSISTENCE_MODES)[number];

export const EVIDENCE_EMBEDDING_MODES = ["local", "none"] as const;
export type EvidenceEmbeddingMode = (typeof EVIDENCE_EMBEDDING_MODES)[number];

export type EvidenceRuntimeEnv = {
  readonly persistence: EvidencePersistenceMode;
  readonly embeddings: EvidenceEmbeddingMode;
};

function readEnum(
  source: NodeJS.ProcessEnv,
  key: string,
  allowed: readonly string[],
  fallback: string | undefined,
): string {
  const raw = source[key]?.trim().toLowerCase();
  if (raw === undefined || raw.length === 0) {
    if (fallback === undefined) {
      throw new Error(`${key} is required and must be ${allowed.join(" or ")}`);
    }
    return fallback;
  }
  if (!allowed.includes(raw)) {
    throw new Error(`${key} must be ${allowed.join(" or ")}`);
  }
  return raw;
}

export function loadEvidenceRuntimeEnv(source: NodeJS.ProcessEnv = process.env): EvidenceRuntimeEnv {
  const raw = source.HIVE_EVIDENCE_EMBEDDINGS?.trim().toLowerCase();
  if (raw === "openai" || raw === "hash") {
    throw new Error(
      "HIVE_EVIDENCE_EMBEDDINGS=openai is not supported for Evidence RAG. Use local or none. Hash embeddings remain test-only.",
    );
  }
  return {
    persistence: readEnum(
      source,
      "HIVE_EVIDENCE_PERSISTENCE",
      EVIDENCE_PERSISTENCE_MODES,
      undefined,
    ) as EvidencePersistenceMode,
    embeddings: readEnum(
      source,
      "HIVE_EVIDENCE_EMBEDDINGS",
      EVIDENCE_EMBEDDING_MODES,
      "local",
    ) as EvidenceEmbeddingMode,
  };
}
