import { HiveError } from "@hives/core";
import type { CorrelationId } from "@hives/contracts";
import {
  DEFAULT_SIGNED_URL_SECONDS,
  type EvidenceObjectStore,
  type ObjectMetadata,
  type ObjectRef,
  type PutCreateOnlyInput,
} from "./port.js";

type StoredObject = {
  bytes: Uint8Array;
  contentType: string;
};

function objectKey(ref: ObjectRef): string {
  return `${ref.bucket}:${ref.path}`;
}

export class InMemoryEvidenceObjectStore implements EvidenceObjectStore {
  private readonly objects = new Map<string, StoredObject>();
  putCreateOnlyCalls = 0;

  constructor(private readonly correlationId: CorrelationId) {}

  async putCreateOnly(input: PutCreateOnlyInput): Promise<void> {
    this.putCreateOnlyCalls += 1;
    const key = objectKey(input);
    if (this.objects.has(key)) {
      throw new HiveError({
        code: "OBJECT_ALREADY_EXISTS",
        category: "STORAGE_ERROR",
        message: "Create-only storage refused to overwrite an existing object.",
        retryable: false,
        severity: "ERROR",
        correlationId: input.correlationId,
      });
    }
    this.objects.set(key, {
      bytes: Uint8Array.from(input.bytes),
      contentType: input.contentType,
    });
  }

  async exists(ref: ObjectRef): Promise<boolean> {
    return this.objects.has(objectKey(ref));
  }

  async getMetadata(ref: ObjectRef): Promise<ObjectMetadata | undefined> {
    const stored = this.objects.get(objectKey(ref));
    if (stored === undefined) {
      return undefined;
    }
    return {
      bucket: ref.bucket,
      path: ref.path,
      byteSize: stored.bytes.byteLength,
      contentType: stored.contentType,
    };
  }

  async downloadBytes(ref: ObjectRef): Promise<Uint8Array> {
    const stored = this.objects.get(objectKey(ref));
    if (stored === undefined) {
      throw new HiveError({
        code: "OBJECT_NOT_FOUND",
        category: "STORAGE_ERROR",
        message: "Stored object was not found.",
        retryable: false,
        severity: "ERROR",
        correlationId: this.correlationId,
      });
    }
    return Uint8Array.from(stored.bytes);
  }

  async createSignedUploadUrl(
    ref: ObjectRef,
    _expiresSeconds: number = DEFAULT_SIGNED_URL_SECONDS,
  ): Promise<{ path: string; token: string }> {
    return { path: ref.path, token: `memory-upload-token:${objectKey(ref)}` };
  }

  async createSignedReadUrl(
    ref: ObjectRef,
    expiresSeconds: number = DEFAULT_SIGNED_URL_SECONDS,
  ): Promise<string> {
    if (!this.objects.has(objectKey(ref))) {
      throw new HiveError({
        code: "OBJECT_NOT_FOUND",
        category: "STORAGE_ERROR",
        message: "Stored object was not found.",
        retryable: false,
        severity: "ERROR",
        correlationId: this.correlationId,
      });
    }
    return `memory://${ref.bucket}/${ref.path}?exp=${expiresSeconds}`;
  }

  async delete(ref: ObjectRef): Promise<void> {
    this.objects.delete(objectKey(ref));
  }
}
