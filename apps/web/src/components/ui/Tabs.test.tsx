// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Tabs } from "./Tabs";

afterEach(cleanup);

describe("Tabs", () => {
  it("selects tabs with underline", () => {
    const onChange = vi.fn();
    render(
      <Tabs
        ariaLabel="Board"
        options={[
          { id: "conversation", label: "Conversation" },
          { id: "ask", label: "Ask Sarah" },
        ]}
        value="conversation"
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Ask Sarah" }));
    expect(onChange).toHaveBeenCalledWith("ask");
    expect(screen.getByRole("tab", { name: "Conversation" }).className).toContain("border-blue");
  });
});