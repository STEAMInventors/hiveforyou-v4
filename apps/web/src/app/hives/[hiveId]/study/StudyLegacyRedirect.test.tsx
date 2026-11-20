// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const replaceMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock }),
}));

import { hiveFindingsPath } from "@/lib/hive-routes";
import { StudyLegacyRedirect } from "./StudyLegacyRedirect";

const HIVE_ID = "11111111-1111-4111-8111-111111111111";

afterEach(() => {
  cleanup();
  replaceMock.mockClear();
  window.location.hash = "";
});

describe("StudyLegacyRedirect", () => {
  it("redirects to findings when the hash is empty", async () => {
    render(<StudyLegacyRedirect hiveId={HIVE_ID} queryString="" />);
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith(hiveFindingsPath(HIVE_ID)));
  });

  it("redirects a disagree hash to gaps and keeps other query params", async () => {
    window.location.hash = "#disagree";
    render(<StudyLegacyRedirect hiveId={HIVE_ID} queryString="ref=1" />);
    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith(`/hives/${HIVE_ID}/findings?ref=1#open-items`),
    );
  });

  it("redirects other hashes to findings", async () => {
    window.location.hash = "#establish";
    render(<StudyLegacyRedirect hiveId={HIVE_ID} queryString="" />);
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith(hiveFindingsPath(HIVE_ID)));
  });
});
