import { describe, expect, it, vi } from "vitest";

const redirect = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => redirect(...args),
}));

const requireAuthenticatedUser = vi.fn();
vi.mock("@/server/supabase/server-client", () => ({
  requireAuthenticatedUser: () => requireAuthenticatedUser(),
}));

describe("LandingPage", () => {
  it("redirects signed-in visitors to /hives", async () => {
    requireAuthenticatedUser.mockResolvedValue({ ok: true });
    redirect.mockImplementation(() => {
      throw new Error("NEXT_REDIRECT");
    });
    const { default: LandingPage } = await import("./page");
    await expect(LandingPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/hives");
  });
});