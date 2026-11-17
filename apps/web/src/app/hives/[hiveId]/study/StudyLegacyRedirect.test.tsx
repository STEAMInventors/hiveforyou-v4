// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const replaceMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock }),
}));

import { hiveFactsPath, hiveMissingPath } from "@/lib/hive-routes";
import { StudyLegacyRedirect } from "./StudyLegacyRedirect";

const HIVE_ID = "11111111-1111-4111-8111-111111111111";

afterEach(() => {
  cleanup();
  replaceMock.mockClear();
  window.location.hash = "";
});

describe("StudyLegacyRedirect", () => {
  it("redirects to facts when hash is empty", async () => {
    render(<StudyLegacyRedirect hiveId={HIVE_ID} queryString="" />);
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith(hiveFactsPath(HIVE_ID)));
  });

  it("redirects missing-related hashes to the missing page", async () => {
    window.location.hash = "#disagree";
    render(<StudyLegacyRedirect hiveId={HIVE_ID} queryString="tab=1" />);
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith(`${hiveMissingPath(HIVE_ID)}?tab=1`));
  });

  it("redirects to facts for non-missing hashes", async () => {
    window.location.hash = "#establish";
    render(<StudyLegacyRedirect hiveId={HIVE_ID} queryString="" />);
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith(hiveFactsPath(HIVE_ID)));
  });
});