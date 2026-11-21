import { describe, expect, it } from "vitest";

import { isDevGalleryPath } from "./dev-gallery-path";

describe("isDevGalleryPath", () => {
  it("matches gallery fixture URLs only", () => {
    expect(isDevGalleryPath("/dev/gallery/home-older-study")).toBe(true);
    expect(isDevGalleryPath("/hives/11111111-1111-4111-8111-111111111111")).toBe(false);
  });
});