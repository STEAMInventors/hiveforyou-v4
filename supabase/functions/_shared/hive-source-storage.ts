export const HIVE_SOURCE_DOCUMENTS_BUCKET = "hive-source-documents";

type StorageListResult = {
  data: StorageListEntry[] | null;
  error: { message: string } | null;
};

type StorageAdminClient = {
  storage: {
    from: (bucket: string) => {
      list: (
        path: string,
        opts: { limit: number; offset: number; search?: string },
      ) => Promise<StorageListResult>;
      remove: (paths: string[]) => Promise<{ error: { message: string } | null }>;
    };
  };
};

const LIST_PAGE_SIZE = 100;

type StorageListEntry = {
  name: string;
  id: string | null;
};

function joinPath(prefix: string, name: string): string {
  return prefix ? `${prefix}/${name}` : name;
}

/** Recursively list object paths under a storage prefix (server credentials). */
export async function listStorageObjectPaths(
  admin: StorageAdminClient,
  bucket: string,
  prefix: string,
): Promise<string[]> {
  const paths: string[] = [];
  const folders: string[] = [prefix.replace(/\/+$/, "")];

  while (folders.length > 0) {
    const folder = folders.pop()!;
    let offset = 0;
    for (;;) {
      const { data, error } = await admin.storage.from(bucket).list(folder, {
        limit: LIST_PAGE_SIZE,
        offset,
      });
      if (error) {
        throw new Error(`storage_list_failed:${error.message}`);
      }
      const entries = (data ?? []) as StorageListEntry[];
      if (entries.length === 0) {
        break;
      }
      for (const entry of entries) {
        const fullPath = joinPath(folder, entry.name);
        if (entry.id === null) {
          folders.push(fullPath);
        } else {
          paths.push(fullPath);
        }
      }
      if (entries.length < LIST_PAGE_SIZE) {
        break;
      }
      offset += LIST_PAGE_SIZE;
    }
  }

  return paths;
}

export function mergeUniquePaths(...groups: string[][]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const group of groups) {
    for (const path of group) {
      const trimmed = path.trim();
      if (!trimmed || seen.has(trimmed)) {
        continue;
      }
      seen.add(trimmed);
      merged.push(trimmed);
    }
  }
  return merged;
}

const REMOVE_BATCH_SIZE = 100;

export async function removeStorageObjects(
  admin: StorageAdminClient,
  bucket: string,
  paths: string[],
): Promise<void> {
  for (let index = 0; index < paths.length; index += REMOVE_BATCH_SIZE) {
    const batch = paths.slice(index, index + REMOVE_BATCH_SIZE);
    const { error } = await admin.storage.from(bucket).remove(batch);
    if (error) {
      throw new Error(`storage_remove_failed:${error.message}`);
    }
  }
}

export async function verifyStoragePrefixEmpty(
  admin: StorageAdminClient,
  bucket: string,
  prefix: string,
): Promise<boolean> {
  const remaining = await listStorageObjectPaths(admin, bucket, prefix);
  return remaining.length === 0;
}
