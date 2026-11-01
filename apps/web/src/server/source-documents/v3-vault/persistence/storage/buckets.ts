export const DEFAULT_HIVE_SOURCE_BUCKET = "hive-source-documents";
export const DEFAULT_HIVE_DERIVED_BUCKET = "hive-derived-artifacts";
export const DEFAULT_HIVE_OUTPUT_BUCKET = "hive-published-outputs";

export const HIVE_BUCKET_IDS = [
  DEFAULT_HIVE_SOURCE_BUCKET,
  DEFAULT_HIVE_DERIVED_BUCKET,
  DEFAULT_HIVE_OUTPUT_BUCKET,
] as const;

export type HiveBucketId = (typeof HIVE_BUCKET_IDS)[number];

export type BucketAdmin = {
  getBucket(id: string): Promise<{ public: boolean } | undefined>;
  createBucket(id: string, options: { public: boolean }): Promise<void>;
  updateBucket(id: string, options: { public: boolean }): Promise<void>;
};

export type BucketSetupResult = {
  readonly created: readonly string[];
  readonly alreadyPrivate: readonly string[];
  readonly madePrivate: readonly string[];
};

export function isHiveBucketId(id: string): id is HiveBucketId {
  return (HIVE_BUCKET_IDS as readonly string[]).includes(id);
}

export async function ensureHiveBuckets(admin: BucketAdmin): Promise<BucketSetupResult> {
  const created: string[] = [];
  const alreadyPrivate: string[] = [];
  const madePrivate: string[] = [];
  for (const id of HIVE_BUCKET_IDS) {
    const existing = await admin.getBucket(id);
    if (existing === undefined) {
      await admin.createBucket(id, { public: false });
      created.push(id);
      continue;
    }
    if (existing.public) {
      await admin.updateBucket(id, { public: false });
      madePrivate.push(id);
      continue;
    }
    alreadyPrivate.push(id);
  }
  return { created, alreadyPrivate, madePrivate };
}
