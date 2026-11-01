import type { CorrelationId } from "@hives/contracts";

export const DEFAULT_SIGNED_URL_SECONDS = 60;

export type ObjectRef = {
  readonly bucket: string;
  readonly path: string;
};

export type ObjectMetadata = {
  readonly bucket: string;
  readonly path: string;
  readonly byteSize: number;
  readonly contentType: string | null;
};

export type PutCreateOnlyInput = ObjectRef & {
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly correlationId: CorrelationId;
};

export type SignedUploadTarget = {
  readonly path: string;
  readonly token: string;
};

export type EvidenceObjectStore = {
  putCreateOnly(input: PutCreateOnlyInput): Promise<void>;
  exists(ref: ObjectRef): Promise<boolean>;
  getMetadata(ref: ObjectRef): Promise<ObjectMetadata | undefined>;
  downloadBytes(ref: ObjectRef): Promise<Uint8Array>;
  createSignedReadUrl(ref: ObjectRef, expiresSeconds?: number): Promise<string>;
  createSignedUploadUrl(ref: ObjectRef, expiresSeconds?: number): Promise<SignedUploadTarget>;
  delete(ref: ObjectRef): Promise<void>;
};
