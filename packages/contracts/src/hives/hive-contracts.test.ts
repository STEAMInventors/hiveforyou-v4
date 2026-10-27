import { describe, expect, it } from "vitest";

import {
  HIVE_DESCRIPTION_MAX_LENGTH,
  HIVE_NAME_MAX_LENGTH,
  isValidUuid,
  normalizeHiveRecord,
  validateCreateHiveInput,
} from "./hive-contracts";

const VALID_UUID = "550e8400-e29b-41d4-a716-446655440000";

describe("validateCreateHiveInput", () => {
  it("rejects client-supplied owner_user_id or ownerUserId", () => {
    expect(
      validateCreateHiveInput({
        name: "My Hive",
        clientRequestId: VALID_UUID,
        owner_user_id: "11111111-1111-4111-8111-111111111111",
      }).ok,
    ).toBe(false);

    expect(
      validateCreateHiveInput({
        name: "My Hive",
        clientRequestId: VALID_UUID,
        ownerUserId: "11111111-1111-4111-8111-111111111111",
      }).ok,
    ).toBe(false);
  });

  it("trims name and description and normalizes empty description to null", () => {
    const result = validateCreateHiveInput({
      name: "  Maya's IEP  ",
      description: "   ",
      clientRequestId: VALID_UUID.toUpperCase(),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        name: "Maya's IEP",
        description: null,
        clientRequestId: VALID_UUID,
      });
    }
  });

  it("accepts snake_case client_request_id for compatibility", () => {
    const result = validateCreateHiveInput({
      name: "Receipts",
      description: "2026 grocery receipts",
      client_request_id: VALID_UUID,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.clientRequestId).toBe(VALID_UUID);
      expect(result.value.description).toBe("2026 grocery receipts");
    }
  });

  it("enforces 100-char name limit and 500-char description limit", () => {
    expect(
      validateCreateHiveInput({
        name: "   ",
        clientRequestId: VALID_UUID,
      }).ok,
    ).toBe(false);

    expect(
      validateCreateHiveInput({
        name: "a".repeat(HIVE_NAME_MAX_LENGTH + 1),
        clientRequestId: VALID_UUID,
      }).ok,
    ).toBe(false);

    expect(
      validateCreateHiveInput({
        name: "a".repeat(HIVE_NAME_MAX_LENGTH),
        description: "b".repeat(HIVE_DESCRIPTION_MAX_LENGTH),
        clientRequestId: VALID_UUID,
      }).ok,
    ).toBe(true);

    expect(
      validateCreateHiveInput({
        name: "Valid",
        description: "b".repeat(HIVE_DESCRIPTION_MAX_LENGTH + 1),
        clientRequestId: VALID_UUID,
      }).ok,
    ).toBe(false);
  });

  it("rejects non-UUID clientRequestId", () => {
    expect(
      validateCreateHiveInput({
        name: "Valid",
        clientRequestId: "not-a-uuid",
      }).ok,
    ).toBe(false);
  });
});

describe("normalizeHiveRecord & isValidUuid", () => {
  it("validates UUIDs and normalizes camelCase or snake_case Hive payloads", () => {
    expect(isValidUuid(VALID_UUID)).toBe(true);
    expect(isValidUuid("invalid")).toBe(false);

    const normalized = normalizeHiveRecord({
      id: VALID_UUID,
      name: "Alpha",
      description: null,
      client_request_id: VALID_UUID,
      created_at: "2026-10-26T21:00:00Z",
      updated_at: "2026-10-26T21:00:00Z",
    });

    expect(normalized).toEqual({
      id: VALID_UUID,
      hiveId: VALID_UUID,
      name: "Alpha",
      description: null,
      clientRequestId: VALID_UUID,
      createdAt: "2026-10-26T21:00:00Z",
      updatedAt: "2026-10-26T21:00:00Z",
    });
  });
});
