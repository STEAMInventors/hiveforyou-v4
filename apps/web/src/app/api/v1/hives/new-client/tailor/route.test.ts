import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAuthenticatedUserMock = vi.fn();
const runChecklistTailorMock = vi.fn();

vi.mock("@/server/supabase/server-client", () => ({
  requireAuthenticatedUser: () => requireAuthenticatedUserMock(),
}));

vi.mock("@/server/hives/checklist-tailor-service", () => ({
  runChecklistTailor: (...args: unknown[]) => runChecklistTailorMock(...args),
  TAILOR_FALLBACK_MESSAGE: "Couldn't tailor right now. Showing the usual list.",
}));

vi.mock("@/server/hives/checklist-tailor-model-runner", () => ({
  createDefaultChecklistTailorModelRunner: () => vi.fn(),
}));

vi.mock("@/server/pipeline/pack-loader", () => ({
  loadPackEntries: () => ({
    entries: [{ id: "widget-review", pack: { meta: { title: "Widget review", version: 1 }, documentsUsuallyNeeded: [] } }],
  }),
}));

const CORRELATION_ID = "2eb8421a-b784-4bf8-ac2b-540299b61d13";

const { POST } = await import("./route");

describe("POST /api/v1/hives/new-client/tailor", () => {
  beforeEach(() => {
    requireAuthenticatedUserMock.mockReset();
    runChecklistTailorMock.mockReset();
    requireAuthenticatedUserMock.mockResolvedValue({
      ok: true,
      client: {
        rpc: vi.fn().mockResolvedValue({
          data: {
            firm: { firmId: "11111111-1111-4111-8111-111111111111", name: "Acme" },
            members: [],
            pendingInvitations: [],
          },
          error: null,
        }),
      },
    });
    runChecklistTailorMock.mockResolvedValue({ tailored: false, message: null, items: [], askCount: 0, leftOutCount: 0 });
  });

  it("returns untailored list for empty text without calling the model runner path", async () => {
    runChecklistTailorMock.mockImplementation(async (_pack, text, _cid, runner) => {
      expect(text).toBe("");
      expect(runner).toBeTruthy();
      return { tailored: false, message: null, items: [], askCount: 0, leftOutCount: 0 };
    });
    const response = await POST(
      new NextRequest("http://localhost/api/v1/hives/new-client/tailor", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-correlation-id": CORRELATION_ID },
        body: JSON.stringify({ packId: "widget-review", professionalText: "" }),
      }),
    );
    expect(response.status).toBe(200);
    expect(runChecklistTailorMock).toHaveBeenCalled();
  });
});