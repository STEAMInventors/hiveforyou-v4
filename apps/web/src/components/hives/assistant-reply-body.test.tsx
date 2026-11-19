// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AssistantReplyBody } from "./assistant-reply-body";

afterEach(() => cleanup());

describe("AssistantReplyBody", () => {
  it("renders bold and list items safely", () => {
    render(
      <AssistantReplyBody text={"**Bold lead** stays.\n- First item\n- Second item"} />,
    );
    const strong = screen.getByText("Bold lead");
    expect(strong.tagName).toBe("STRONG");
    expect(screen.getByText("First item")).toBeTruthy();
    expect(screen.getByText("Second item")).toBeTruthy();
  });

  it("keeps script-like text literal", () => {
    render(<AssistantReplyBody text={'<script>alert("x")</script>'} />);
    expect(screen.getByText('<script>alert("x")</script>')).toBeTruthy();
    expect(document.querySelector("script")).toBeNull();
  });
});