// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DocumentDropZone } from "./DocumentDropZone";

afterEach(cleanup);

describe("DocumentDropZone", () => {
  it("opens the file picker on Enter", () => {
    const onAdd = vi.fn();
    render(<DocumentDropZone onAdd={onAdd} quotaText="PDF, PNG, JPG or DOCX, up to 25 MB each." />);
    const zone = screen.getByTestId("document-drop-zone");
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const click = vi.spyOn(input, "click");
    fireEvent.keyDown(zone, { key: "Enter" });
    expect(click).toHaveBeenCalled();
  });
});