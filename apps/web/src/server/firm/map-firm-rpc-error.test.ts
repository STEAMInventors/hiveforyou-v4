import { describe, expect, it } from "vitest";

import { firmRpcHttpStatus, mapFirmRpcError } from "./map-firm-rpc-error";

const CORRELATION_ID = "2eb8421a-b784-4bf8-ac2b-540299b61d13";

describe("mapFirmRpcError", () => {
  it("maps 42501 to NOT_FOUND without revealing access", () => {
    const mapped = mapFirmRpcError({ code: "42501", message: "access_denied" }, CORRELATION_ID);
    expect(mapped.errorCode).toBe("NOT_FOUND");
    expect(mapped.safeMessage).not.toMatch(/access_denied/);
    expect(firmRpcHttpStatus(mapped)).toBe(404);
  });

  it("maps 22023 to field-safe validation at 400", () => {
    const mapped = mapFirmRpcError({ code: "22023", message: "invalid_request:body" }, CORRELATION_ID);
    expect(mapped.errorCode).toBe("INVALID_REQUEST");
    expect(mapped.safeMessage).toMatch(/2000 characters/);
    expect(firmRpcHttpStatus(mapped)).toBe(400);
  });

  it("maps rate_limited to 429", () => {
    const mapped = mapFirmRpcError({ code: "P0001", message: "rate_limited" }, CORRELATION_ID);
    expect(mapped.retryable).toBe(false);
    expect(mapped.safeMessage).toMatch(/several requests today/);
    expect(firmRpcHttpStatus(mapped)).toBe(429);
  });

  it("maps unknown rpc errors to retryable 503 with a safe message", () => {
    const mapped = mapFirmRpcError({ code: "XX000", message: "secret internal detail" }, CORRELATION_ID);
    expect(mapped.errorCode).toBe("PERSISTENCE_FAILED");
    expect(mapped.retryable).toBe(true);
    expect(mapped.safeMessage).toBe("Could not save right now. Try again.");
    expect(mapped.safeMessage).not.toContain("secret");
    expect(firmRpcHttpStatus(mapped)).toBe(503);
  });
});