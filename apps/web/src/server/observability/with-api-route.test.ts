import { createHiveError } from "@hiveforyou/contracts";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import { withApiRoute } from "./with-api-route";

const CORRELATION_ID = "2eb8421a-b784-4bf8-ac2b-540299b61d13";

describe("withApiRoute", () => {
  it("returns public error JSON when handler throws", async () => {
    const handler = withApiRoute("shell", "healthCheck", () => {
      throw createHiveError({
        errorCode: "INVALID_REQUEST",
        category: "VALIDATION",
        stage: "SHELL",
        retryable: false,
        safeMessage: "Invalid request.",
        correlationId: "unused",
      });
    });

    const request = new NextRequest("http://localhost/api/health", {
      headers: { "x-correlation-id": "2eb8421a-b784-4bf8-ac2b-540299b61d13" },
    });

    const response = await handler(request);
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error.errorCode).toBe("INVALID_REQUEST");
    expect(body.error.correlationId).toBe(CORRELATION_ID);
    expect(JSON.stringify(body)).not.toContain("stack");
  });

  it("returns a stable safe response and the same correlation id in the failure log", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const secret = "postgres://user:password@localhost/hive token=sk-live";
    const handler = withApiRoute("shell", "healthCheck", () => {
      const error = new Error(`connection failed ${secret} at C:\\Users\\secret\\db.ts`);
      (error as Error & { documentText?: string; nested?: unknown }).documentText =
        "patient chart text";
      (error as Error & { nested?: unknown }).nested = {
        exactQuote: "verbatim diagnosis",
        password: "hunter2",
        token: "sk-live-secret",
      };
      throw error;
    });

    try {
      const response = await handler(
        new NextRequest("http://localhost/api/health?documentText=patient-chart", {
          headers: { "x-correlation-id": CORRELATION_ID },
        }),
      );
      const body = await response.json();
      const serialized = JSON.stringify(body);

      expect(response.status).toBe(500);
      expect(response.headers.get("x-correlation-id")).toBe(CORRELATION_ID);
      expect(Object.keys(body.error).sort()).toEqual(
        ["category", "correlationId", "errorCode", "message", "retryable", "stage", "timestamp"].sort(),
      );
      expect(body.error).toEqual({
        errorCode: "INTERNAL_ERROR",
        category: "INTERNAL",
        message: "Something went wrong. You can try again or contact support with your reference.",
        stage: "SHELL",
        retryable: false,
        correlationId: CORRELATION_ID,
        timestamp: body.error.timestamp,
      });
      expect(body.error.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(serialized).not.toContain("postgres");
      expect(serialized).not.toContain("password");
      expect(serialized).not.toContain("sk-live");
      expect(serialized).not.toContain("patient");
      expect(serialized).not.toContain("verbatim");
      expect(serialized).not.toContain("db.ts");
      expect(serialized).not.toContain("stack");
      expect(body.error).not.toHaveProperty("cause");

      const lines = logSpy.mock.calls.map((call) => String(call[0]));
      const failureLine = lines.find((line) => line.includes("healthCheck.failed"));
      expect(failureLine).toBeTruthy();
      const logged = JSON.parse(failureLine ?? "{}") as Record<string, unknown>;
      expect(logged.correlationId).toBe(CORRELATION_ID);
      expect(logged.stage).toBe("SHELL");
      expect(logged.errorCode).toBe("INTERNAL_ERROR");
      expect(logged.status).toBe("FAILED");
      expect(logged.diagnosticReason).toBe("unexpected_exception");
      expect(logged.severity).toBe("ERROR");

      const combined = lines.join("\n");
      expect(combined).not.toContain("postgres");
      expect(combined).not.toContain("sk-live");
      expect(combined).not.toContain("patient");
      expect(combined).not.toContain("verbatim");
      expect(combined).not.toContain("hunter2");
      expect(combined).not.toContain("db.ts");
      expect(combined.toLowerCase()).not.toContain("password");
    } finally {
      logSpy.mockRestore();
    }
  });
});
