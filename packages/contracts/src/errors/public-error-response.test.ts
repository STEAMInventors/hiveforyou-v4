import { describe, expect, it } from "vitest";
import { createHiveError } from "./hive-error";
import { suggestedHttpStatus, toPublicErrorResponse } from "./public-error-response";

describe("toPublicErrorResponse", () => {
  it("returns normative public shape", () => {
    const body = toPublicErrorResponse(
      createHiveError({
        errorCode: "INTERNAL_ERROR",
        category: "INTERNAL",
        stage: "SHELL",
        retryable: false,
        safeMessage: "Something went wrong.",
        correlationId: "2eb8421a-b784-4bf8-ac2b-540299b61d13",
      }),
    );

    expect(body.error.errorCode).toBe("INTERNAL_ERROR");
    expect(body.error.category).toBe("INTERNAL");
    expect(body.error.message).toBe("Something went wrong.");
    expect(body.error.stage).toBe("SHELL");
    expect(body.error.retryable).toBe(false);
    expect(body.error.correlationId).toBe("2eb8421a-b784-4bf8-ac2b-540299b61d13");
    expect(body.error.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body.error).not.toHaveProperty("cause");
  });

  it("does not serialize cause or caller-supplied internal fields", () => {
    const error = createHiveError({
      errorCode: "INTERNAL_ERROR",
      category: "INTERNAL",
      stage: "SHELL",
      retryable: false,
      safeMessage: "Something went wrong.",
      correlationId: "2eb8421a-b784-4bf8-ac2b-540299b61d13",
      cause: {
        password: "hunter2",
        documentText: "patient chart text",
        nested: { token: "sk-live", exactQuote: "verbatim diagnosis" },
      },
      sql: "select * from secrets",
      stack: "at C:\\Users\\secret\\db.ts",
    } as ReturnType<typeof createHiveError>);

    const serialized = JSON.stringify(error);
    expect(error.cause).toBeDefined();
    expect(serialized).not.toContain("hunter2");
    expect(serialized).not.toContain("patient chart");
    expect(serialized).not.toContain("sk-live");
    expect(serialized).not.toContain("verbatim diagnosis");
    expect(serialized).not.toContain("secrets");
    expect(serialized).not.toContain("db.ts");

    const body = toPublicErrorResponse(error);
    expect(JSON.stringify(body)).not.toContain("hunter2");
    expect(body.error).not.toHaveProperty("cause");
    expect(body.error).not.toHaveProperty("stack");
    expect(body.error).not.toHaveProperty("sql");
  });
});

describe("suggestedHttpStatus", () => {
  it("maps known codes", () => {
    expect(suggestedHttpStatus("INVALID_REQUEST")).toBe(422);
    expect(suggestedHttpStatus("INTERNAL_ERROR")).toBe(500);
  });
});
