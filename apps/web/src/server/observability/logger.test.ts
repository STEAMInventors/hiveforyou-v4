import { describe, expect, it, vi } from "vitest";

import { buildStructuredLogRecord, emitStructuredEvent } from "./logger";

describe("buildStructuredLogRecord", () => {
  it("keeps allowlisted fields only", () => {
    const record = buildStructuredLogRecord({
      eventName: "health.check.completed",
      severity: "INFO",
      timestamp: "2026-10-26T21:00:00Z",
      component: "shell",
      operation: "healthCheck",
      correlationId: "2eb8421a-b784-4bf8-ac2b-540299b61d13",
      documentText: "secret content",
      extraField: "drop me",
      durationMs: 12,
    });

    expect(record.durationMs).toBe(12);
    expect(record).not.toHaveProperty("extraField");
    expect(record).not.toHaveProperty("documentText");
  });
});

describe("emitStructuredEvent", () => {
  it("does not leak sensitive substrings in output", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    emitStructuredEvent({
      eventName: "health.check.completed",
      severity: "INFO",
      timestamp: "2026-10-26T21:00:00Z",
      component: "shell",
      operation: "healthCheck",
      correlationId: "2eb8421a-b784-4bf8-ac2b-540299b61d13",
      status: "SUCCEEDED",
      durationMs: 5,
    });

    const line = logSpy.mock.calls[0]?.[0];
    expect(typeof line).toBe("string");
    expect(line).not.toContain("exactQuote");
    expect(line).not.toContain("password");

    logSpy.mockRestore();
  });

  it("omits nested sensitive values and still logs stage and error fields", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const trap = {
      toJSON() {
        return { password: "hunter2", documentText: "patient chart", token: "sk-live" };
      },
    };

    emitStructuredEvent({
      eventName: "healthCheck.failed",
      severity: "ERROR",
      timestamp: "2026-10-26T21:00:00.000Z",
      component: "shell",
      operation: "healthCheck",
      correlationId: "2eb8421a-b784-4bf8-ac2b-540299b61d13",
      stage: "SHELL",
      status: "FAILED",
      errorCode: "INTERNAL_ERROR",
      diagnosticReason: "unexpected_exception",
      hiveId: trap,
      details: {
        documentText: "full page OCR of patient chart",
        exactQuote: "verbatim diagnosis sentence",
        password: "hunter2",
        nested: {
          token: "sk-live-secret",
          authorization: "Bearer super-secret",
          prompt: "system prompt body",
        },
      },
      cause: new Error("SQLSTATE connection string at C:\\secrets\\db"),
    });

    const line = String(logSpy.mock.calls[0]?.[0]);
    const logged = JSON.parse(line) as Record<string, unknown>;
    expect(logged.correlationId).toBe("2eb8421a-b784-4bf8-ac2b-540299b61d13");
    expect(logged.stage).toBe("SHELL");
    expect(logged.errorCode).toBe("INTERNAL_ERROR");
    expect(logged.status).toBe("FAILED");
    expect(line).not.toContain("patient chart");
    expect(line).not.toContain("verbatim diagnosis");
    expect(line).not.toContain("hunter2");
    expect(line).not.toContain("sk-live");
    expect(line).not.toContain("Bearer");
    expect(line).not.toContain("system prompt");
    expect(line).not.toContain("SQLSTATE");
    expect(line).not.toContain("documentText");
    expect(line).not.toContain("exactQuote");
    expect(line.toLowerCase()).not.toContain("password");

    logSpy.mockRestore();
  });

  it("refuses to emit when an allowlisted value contains a sensitive marker", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    expect(() =>
      emitStructuredEvent({
        eventName: "healthCheck.failed",
        severity: "ERROR",
        timestamp: "2026-10-26T21:00:00.000Z",
        component: "shell",
        operation: "healthCheck",
        correlationId: "2eb8421a-b784-4bf8-ac2b-540299b61d13",
        hiveId: "Password=hunter2",
      }),
    ).toThrow(/sensitive marker/);
    expect(logSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
  });
});
