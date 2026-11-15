import { describe, expect, it, vi } from "vitest";

import { resolvePostSignInPath } from "./post-sign-in";

describe("resolvePostSignInPath", () => {
  it("sends new users to welcome and returning users to next", async () => {
    const supabase = {
      rpc: vi
        .fn()
        .mockResolvedValueOnce({ data: null, error: null })
        .mockResolvedValueOnce({
          data: {
            userId: "aaaaaaaa-0000-4000-8000-000000000001",
            startingView: "own",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
          error: null,
        }),
    };

    await expect(resolvePostSignInPath(supabase as never, "/hives?create=1")).resolves.toBe(
      "/welcome?next=%2Fhives%3Fcreate%3D1",
    );
    await expect(resolvePostSignInPath(supabase as never, "/hives")).resolves.toBe("/hives");
  });

  it("preserves next on the welcome path for new users", async () => {
    const supabase = {
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    await expect(resolvePostSignInPath(supabase as never, "/hives/x")).resolves.toBe(
      "/welcome?next=%2Fhives%2Fx",
    );
  });

  it("refuses unsafe next destinations", async () => {
    const supabase = {
      rpc: vi.fn().mockResolvedValue({
        data: {
          userId: "aaaaaaaa-0000-4000-8000-000000000001",
          startingView: "own",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        error: null,
      }),
    };
    await expect(
      resolvePostSignInPath(supabase as never, "https://evil.example.com"),
    ).resolves.toBe("/hives");
  });
});