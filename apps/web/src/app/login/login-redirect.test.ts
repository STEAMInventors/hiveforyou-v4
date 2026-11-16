import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

import LoginPage from "./page";

describe("/login redirect", () => {
  it("preserves next, start, and error on the sign-in route", async () => {
    await expect(
      LoginPage({
        searchParams: Promise.resolve({
          next: "/hives/abc/documents",
          start: "clients",
          error: "otp_expired",
        }),
      }),
    ).rejects.toThrow(
      "REDIRECT:/sign-in?next=%2Fhives%2Fabc%2Fdocuments&start=clients&error=otp_expired",
    );
  });

  it("preserves new on the sign-in route", async () => {
    await expect(
      LoginPage({
        searchParams: Promise.resolve({
          next: "/hives",
          new: "1",
        }),
      }),
    ).rejects.toThrow("REDIRECT:/sign-in?next=%2Fhives&new=1");
  });
});