// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const replaceMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock }),
}));

import { hiveHomeShowPath } from "@/lib/hive-routes";
import { StudyLegacyRedirect } from "./StudyLegacyRedirect";

const HIVE_ID = "11111111-1111-4111-8111-111111111111";

afterEach(() => {
  cleanup();
  replaceMock.mockClear();
  window.location.hash = "";
});

describe("StudyLegacyRedirect", () => {
  it("redirects to Home when the hash is empty", async () => {
    render(<StudyLegacyRedirect hiveId={HIVE_ID} queryString="" />);
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith(hiveHomeShowPath(HIVE_ID)));
  });

  it("redirects a disagree hash to Home and keeps other query params", async () => {
    window.location.hash = "#disagree";
    render(<StudyLegacyRedirect hiveId={HIVE_ID} queryString="ref=1" />);
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith(`/hives/${HIVE_ID}?ref=1#show`));
  });

  it("redirects other hashes to Home", async () => {
    window.location.hash = "#establish";
    render(<StudyLegacyRedirect hiveId={HIVE_ID} queryString="" />);
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith(hiveHomeShowPath(HIVE_ID)));
  });

  it("opens Findings for a personal Hive and keeps the query and hash", async () => {
    window.location.hash = "#timeline";
    render(<StudyLegacyRedirect hiveId={HIVE_ID} queryString="ref=1" destination="findings" />);
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith(`/hives/${HIVE_ID}/findings?ref=1#timeline`));
  });
});
