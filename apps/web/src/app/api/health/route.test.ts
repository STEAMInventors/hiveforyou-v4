import { isValidCorrelationId } from "@hiveforyou/contracts";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import { GET } from "./route";

const CORRELATION_ID = "2eb8421a-b784-4bf8-ac2b-540299b61d13";

describe("GET /api/health", () => {
  it("returns the caller correlation id on the body, header, and completion log", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      const response = await GET(
        new NextRequest(
          "http://localhost/api/health?token=sk-live&documentText=patient-chart",
          { headers: { "x-correlation-id": CORRELATION_ID } },
        ),
      );
      const body = await response.json();
      const lines = logSpy.mock.calls.map((call) => String(call[0]));
      const completed = lines.find((line) => line.includes("healthCheck.completed"));
      const logged = JSON.parse(completed ?? "{}") as Record<string, unknown>;

      expect(response.status).toBe(200);
      expect(body).toEqual({ ok: true, correlationId: CORRELATION_ID });
      expect(response.headers.get("x-correlation-id")).toBe(CORRELATION_ID);
      expect(logged.correlationId).toBe(CORRELATION_ID);
      expect(logged.stage).toBe("SHELL");
      expect(logged.status).toBe("SUCCEEDED");

      const combined = lines.join("\n");
      expect(combined).not.toContain("sk-live");
      expect(combined).not.toContain("patient-chart");
      expect(combined.toLowerCase()).not.toContain("token");
      expect(combined).not.toContain("documentText");
    } finally {
      logSpy.mockRestore();
    }
  });

  it("replaces an invalid correlation id and does not log it", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const secretHeader =
      "password=hunter2 token=sk-live documentText=patient-chart exactQuote=verbatim";

    try {
      const response = await GET(
        new NextRequest("http://localhost/api/health", {
          headers: { "x-correlation-id": secretHeader },
        }),
      );
      const body = await response.json();
      const lines = logSpy.mock.calls.map((call) => String(call[0]));
      const combined = lines.join("\n");

      expect(response.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.correlationId).not.toBe(secretHeader);
      expect(isValidCorrelationId(body.correlationId)).toBe(true);
      expect(response.headers.get("x-correlation-id")).toBe(body.correlationId);
      expect(combined).toContain(body.correlationId);
      expect(combined).not.toContain("hunter2");
      expect(combined).not.toContain("sk-live");
      expect(combined).not.toContain("patient-chart");
      expect(combined).not.toContain("verbatim");
      expect(combined.toLowerCase()).not.toContain("password");
      expect(combined).not.toContain("documentText");
      expect(combined).not.toContain("exactQuote");
    } finally {
      logSpy.mockRestore();
    }
  });
});
