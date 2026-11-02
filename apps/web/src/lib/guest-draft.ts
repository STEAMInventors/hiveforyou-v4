"use client";

/**
 * A signed-out visitor's intent and selected files, kept only in this browser
 * across sign-up. Never sent anywhere until the owner creates a Hive.
 */
export type GuestDraft = {
  intentText: string;
  audience?: string;
  files: File[];
};

type StoredDraft = GuestDraft & { savedAt: number };

const DATABASE_NAME = "hiveforyou-guest-draft";
const STORE_NAME = "drafts";
const DRAFT_KEY = "current";
export const GUEST_DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const request = run(transaction.objectStore(STORE_NAME));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

export async function saveGuestDraft(draft: GuestDraft): Promise<void> {
  const stored: StoredDraft = { ...draft, savedAt: Date.now() };
  await withStore("readwrite", (store) => store.put(stored, DRAFT_KEY));
}

export async function clearGuestDraft(): Promise<void> {
  try {
    await withStore("readwrite", (store) => store.delete(DRAFT_KEY));
  } catch {
    // Nothing to clear when IndexedDB is unavailable.
  }
}

export async function loadGuestDraft(): Promise<GuestDraft | null> {
  let stored: StoredDraft | undefined;
  try {
    stored = await withStore<StoredDraft | undefined>("readonly", (store) => store.get(DRAFT_KEY));
  } catch {
    return null;
  }
  if (!stored) {
    return null;
  }
  if (Date.now() - stored.savedAt > GUEST_DRAFT_MAX_AGE_MS) {
    await clearGuestDraft();
    return null;
  }
  return { intentText: stored.intentText, audience: stored.audience ?? "", files: stored.files };
}
