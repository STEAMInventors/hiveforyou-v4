import { describe, expect, it } from "vitest";

import { routeErrorReferences } from "./route-error-reference";

describe("routeErrorReferences", () => {
  it("prefers correlationId over Next digest", () => {
    const error = Object.assign(new Error("fail"), {
      digest: "next-digest",
      correlationId: "2eb8421a-b784-4bf8-ac2b-540299b61d13",
    });
    expect(routeErrorReferences(error)).toEqual({
      correlationId: "2eb8421a-b784-4bf8-ac2b-540299b61d13",
      errorDigest: null,
    });
  });

  it("reads correlationId from nested cause", () => {
    const cause = Object.assign(new Error("root"), { correlationId: "abcd1234-0000-4000-8000-000000000099" });
    const error = Object.assign(new Error("wrapper"), { digest: "next-digest", cause });
    expect(routeErrorReferences(error).correlationId).toBe("abcd1234-0000-4000-8000-000000000099");
  });

  it("falls back to digest only when no correlation id is present", () => {
    const error = Object.assign(new Error("fail"), { digest: "digest-123" });
    expect(routeErrorReferences(error)).toEqual({ correlationId: null, errorDigest: "digest-123" });
  });
});