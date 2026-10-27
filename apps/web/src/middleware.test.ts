import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { isProtectedPath, middleware } from "./middleware";

describe("middleware", () => {
  it("identifies protected /hives and /account routes", () => {
    expect(isProtectedPath("/hives")).toBe(true);
    expect(isProtectedPath("/hives/123/documents")).toBe(true);
    expect(isProtectedPath("/account/password")).toBe(true);
    expect(isProtectedPath("/")).toBe(false);
    expect(isProtectedPath("/login")).toBe(false);
  });

  it("redirects unauthenticated requests for /hives to /login with x-correlation-id", async () => {
    const req = new NextRequest("http://localhost:3000/hives", {
      headers: {
        "x-correlation-id": "2eb8421a-b784-4bf8-ac2b-540299b61d13",
      },
    });
    const res = await middleware(req);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "http://localhost:3000/login?next=%2Fhives",
    );
    expect(res.headers.get("x-correlation-id")).toBe(
      "2eb8421a-b784-4bf8-ac2b-540299b61d13",
    );
  });

  it("sanitizes external next query parameters on /login", async () => {
    const req = new NextRequest(
      "http://localhost:3000/login?next=https://evil.example.com",
    );
    const res = await middleware(req);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "http://localhost:3000/login?next=%2Fhives",
    );
  });
});
