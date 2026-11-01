import { HiveError } from "@hives/core";
import type { CorrelationId } from "@hives/contracts";
import {
  DEFAULT_SIGNED_URL_SECONDS,
  type EvidenceObjectStore,
  type ObjectMetadata,
  type ObjectRef,
  type PutCreateOnlyInput,
} from "./port.js";

export type StorageCallError = {
  readonly message: string;
  readonly statusCode?: string | undefined;
};

export type SupabaseObjectEntry = {
  readonly name: string;
  readonly metadata?: { readonly size?: number | undefined } | null | undefined;
};

export type SupabaseDownloadedObject =
  | Uint8Array
  | ArrayBuffer
  | { readonly arrayBuffer: () => Promise<ArrayBuffer> };

export type SupabaseBucketApi = {
  upload(
    path: string,
    data: Uint8Array,
    options: { upsert: boolean; contentType: string },
  ): Promise<{ error: StorageCallError | null }>;
  download(
    path: string,
  ): Promise<{ data: SupabaseDownloadedObject | null; error: StorageCallError | null }>;
  createSignedUrl(
    path: string,
    expiresIn: number,
  ): Promise<{ data: { signedUrl: string } | null; error: StorageCallError | null }>;
  createSignedUploadUrl(
    path: string,
    options?: { upsert?: boolean },
  ): Promise<{ data: { path: string; token: string; signedUrl?: string } | null; error: StorageCallError | null }>;
  remove(paths: string[]): Promise<{ error: StorageCallError | null }>;
  list(
    path: string,
    options?: { search?: string },
  ): Promise<{ data: SupabaseObjectEntry[] | null; error: StorageCallError | null }>;
};

export type SupabaseStorageClient = {
  storage: {
    from(bucket: string): SupabaseBucketApi;
  };
};

function isAlreadyExists(error: StorageCallError): boolean {
  const code = error.statusCode ?? "";
  const message = error.message.toLowerCase();
  return code === "409" || message.includes("already exists") || message.includes("duplicate");
}

function parentPath(path: string): { folder: string; name: string } {
  const idx = path.lastIndexOf("/");
  if (idx < 0) {
    return { folder: "", name: path };
  }
  return { folder: path.slice(0, idx), name: path.slice(idx + 1) };
}

async function copyDownloadedBytes(data: SupabaseDownloadedObject): Promise<Uint8Array> {
  if (data instanceof Uint8Array) {
    return Uint8Array.from(data);
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data.slice(0));
  }
  return new Uint8Array(await data.arrayBuffer());
}

export class SupabaseEvidenceObjectStore implements EvidenceObjectStore {
  constructor(
    private readonly client: SupabaseStorageClient,
    private readonly correlationId: CorrelationId,
  ) {}

  async putCreateOnly(input: PutCreateOnlyInput): Promise<void> {
    const { error } = await this.client.storage.from(input.bucket).upload(input.path, input.bytes, {
      upsert: false,
      contentType: input.contentType,
    });
    if (error === null) {
      return;
    }
    if (isAlreadyExists(error)) {
      throw new HiveError({
        code: "OBJECT_ALREADY_EXISTS",
        category: "STORAGE_ERROR",
        message: "Create-only storage refused to overwrite an existing object.",
        retryable: false,
        severity: "ERROR",
        correlationId: input.correlationId,
      });
    }
    throw new HiveError({
      code: "UPLOAD_STORAGE_FAILED",
      category: "STORAGE_ERROR",
      message: "Source evidence upload failed.",
      retryable: true,
      severity: "ERROR",
      correlationId: input.correlationId,
    });
  }

  async exists(ref: ObjectRef): Promise<boolean> {
    const { folder, name } = parentPath(ref.path);
    const { data, error } = await this.client.storage
      .from(ref.bucket)
      .list(folder, { search: name });
    if (error !== null) {
      throw new HiveError({
        code: "STORAGE_METADATA_FAILED",
        category: "STORAGE_ERROR",
        message: "Unable to read storage object metadata.",
        retryable: true,
        severity: "ERROR",
        correlationId: this.correlationId,
      });
    }
    return (data ?? []).some((entry) => entry.name === name);
  }

  async downloadBytes(ref: ObjectRef): Promise<Uint8Array> {
    const { data, error } = await this.client.storage.from(ref.bucket).download(ref.path);
    if (error !== null || data === null) {
      throw new HiveError({
        code: "OBJECT_NOT_FOUND",
        category: "STORAGE_ERROR",
        message: "Stored object was not found.",
        retryable: true,
        severity: "ERROR",
        correlationId: this.correlationId,
      });
    }
    return copyDownloadedBytes(data);
  }

  async getMetadata(ref: ObjectRef): Promise<ObjectMetadata | undefined> {
    const { folder, name } = parentPath(ref.path);
    const { data, error } = await this.client.storage
      .from(ref.bucket)
      .list(folder, { search: name });
    if (error !== null) {
      throw new HiveError({
        code: "STORAGE_METADATA_FAILED",
        category: "STORAGE_ERROR",
        message: "Unable to read storage object metadata.",
        retryable: true,
        severity: "ERROR",
        correlationId: this.correlationId,
      });
    }
    const found = (data ?? []).find((entry) => entry.name === name);
    if (found === undefined) {
      return undefined;
    }
    return {
      bucket: ref.bucket,
      path: ref.path,
      byteSize: found.metadata?.size ?? 0,
      contentType: null,
    };
  }

  async createSignedUploadUrl(
    ref: ObjectRef,
    _expiresSeconds: number = DEFAULT_SIGNED_URL_SECONDS,
  ): Promise<{ path: string; token: string }> {
    const { data, error } = await this.client.storage
      .from(ref.bucket)
      .createSignedUploadUrl(ref.path, { upsert: false });
    if (error !== null || data === null) {
      throw new HiveError({
        code: "SIGNED_URL_FAILED",
        category: "STORAGE_ERROR",
        message: "Unable to create a signed upload URL.",
        retryable: true,
        severity: "ERROR",
        correlationId: this.correlationId,
      });
    }
    return { path: data.path, token: data.token };
  }

  async createSignedReadUrl(
    ref: ObjectRef,
    expiresSeconds: number = DEFAULT_SIGNED_URL_SECONDS,
  ): Promise<string> {
    const { data, error } = await this.client.storage
      .from(ref.bucket)
      .createSignedUrl(ref.path, expiresSeconds);
    if (error !== null || data === null) {
      throw new HiveError({
        code: "SIGNED_URL_FAILED",
        category: "STORAGE_ERROR",
        message: "Unable to create a signed read URL.",
        retryable: true,
        severity: "ERROR",
        correlationId: this.correlationId,
      });
    }
    return data.signedUrl;
  }

  async delete(ref: ObjectRef): Promise<void> {
    const { error } = await this.client.storage.from(ref.bucket).remove([ref.path]);
    if (error !== null) {
      throw new HiveError({
        code: "STORAGE_DELETE_FAILED",
        category: "STORAGE_ERROR",
        message: "Unable to delete a storage object.",
        retryable: true,
        severity: "ERROR",
        correlationId: this.correlationId,
      });
    }
  }
}
