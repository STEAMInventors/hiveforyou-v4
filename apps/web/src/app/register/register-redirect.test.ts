import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

import RegisterPage from "./page";

describe("/register redirect", () => {
  it("preserves next and start on the sign-in route", async () => {
    await expect(
      RegisterPage({
        searchParams: Promise.resolve({ next: "/hives", start: "clients" }),
      }),
    ).rejects.toThrow("REDIRECT:/sign-in?next=%2Fhives&start=clients");
  });
});