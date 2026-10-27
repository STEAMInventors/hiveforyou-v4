import { createHiveError, toPublicErrorResponse } from "@hiveforyou/contracts";
import { describe, expect, it } from "vitest";

import { mapExceptionToHiveError } from "./map-exception-to-hive-error";

const BOUNDARY_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

describe("mapExceptionToHiveError", () => {
  it("maps unknown errors to INTERNAL_ERROR without serializing internals", () => {
    const mapped = mapExceptionToHiveError(
      {
        message: "database connection string failed",
        stack: "Error\n    at C:\\Users\\secret\\repo\\db.ts:10",
        nested: { password: "hunter2", token: "sk-live", documentText: "patient chart" },
      },
      BOUNDARY_ID,
    );

    expect(mapped.errorCode).toBe("INTERNAL_ERROR");
    expect(mapped.category).toBe("INTERNAL");
    expect(mapped.stage).toBe("SHELL");
    expect(mapped.retryable).toBe(false);
    expect(mapped.correlationId).toBe(BOUNDARY_ID);
    expect(mapped.safeMessage).not.toContain("database");
    expect(mapped.cause).toBeDefined();

    const serialized = JSON.stringify(mapped);
    expect(serialized).not.toContain("connection string");
    expect(serialized).not.toContain("hunter2");
    expect(serialized).not.toContain("sk-live");
    expect(serialized).not.toContain("patient chart");
    expect(serialized).not.toContain("db.ts");

    const body = toPublicErrorResponse(mapped);
    expect(JSON.stringify(body)).not.toContain("connection string");
    expect(body.error).not.toHaveProperty("cause");
    expect(body.error.message).toBe(mapped.safeMessage);
  });

  it("does not trust a partial object that only looks like a public error", () => {
    const mapped = mapExceptionToHiveError(
      {
        errorCode: "INTERNAL_ERROR",
        correlationId: "spoofed-id",
        safeMessage: "password=hunter2 token=sk-live at C:\\secrets\\app.ts",
        stack: "at internal.ts",
      },
      BOUNDARY_ID,
    );

    expect(mapped.errorCode).toBe("INTERNAL_ERROR");
    expect(mapped.correlationId).toBe(BOUNDARY_ID);
    expect(mapped.safeMessage).not.toContain("hunter2");
    expect(JSON.stringify(toPublicErrorResponse(mapped))).not.toContain("hunter2");
    expect(JSON.stringify(toPublicErrorResponse(mapped))).not.toContain("app.ts");
  });

  it("preserves HiveError fields and the boundary correlation id", () => {
    const mapped = mapExceptionToHiveError(
      createHiveError({
        errorCode: "INVALID_REQUEST",
        category: "VALIDATION",
        stage: "SHELL",
        retryable: false,
        safeMessage: "Invalid request.",
        correlationId: "2eb8421a-b784-4bf8-ac2b-540299b61d13",
        cause: { sql: "select * from secrets" },
      }),
      BOUNDARY_ID,
    );

    expect(mapped.errorCode).toBe("INVALID_REQUEST");
    expect(mapped.safeMessage).toBe("Invalid request.");
    expect(mapped.correlationId).toBe(BOUNDARY_ID);
    expect(mapped.cause).toEqual({ sql: "select * from secrets" });
    expect(JSON.stringify(mapped)).not.toContain("secrets");
  });
});
