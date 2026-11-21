// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  EMPTY_OMNI_CATALOG,
  OmniCatalogProvider,
  useOmniCatalog,
  useRegisterOmniCatalog,
  type OmniCatalog,
} from "./omni-catalog";

const STABLE: OmniCatalog = {
  ...EMPTY_OMNI_CATALOG,
  statements: [{ id: "s1", text: "Margaret Ellis is the account holder.", topic: "People", pageLabel: "p.1", ref: null }],
};

function Publisher({ catalog = STABLE, enabled = true }: { catalog?: OmniCatalog; enabled?: boolean }) {
  useRegisterOmniCatalog(catalog, enabled);
  return null;
}

function Reader() {
  const catalog = useOmniCatalog();
  return <span data-testid="count">{catalog.statements.length}</span>;
}

afterEach(() => cleanup());

describe("useRegisterOmniCatalog", () => {
  it("does not re-publish in a loop when the catalog is unchanged", () => {
    let reads = 0;
    function CountingReader() {
      reads += 1;
      return <Reader />;
    }
    const { rerender } = render(
      <OmniCatalogProvider>
        <Publisher />
        <CountingReader />
      </OmniCatalogProvider>,
    );
    expect(reads).toBe(1);
    rerender(
      <OmniCatalogProvider>
        <Publisher />
        <CountingReader />
      </OmniCatalogProvider>,
    );
    expect(reads).toBeLessThanOrEqual(3);
  });

  it("clears the catalog when the publisher unmounts", () => {
    const { unmount, getByTestId } = render(
      <OmniCatalogProvider>
        <Publisher />
        <Reader />
      </OmniCatalogProvider>,
    );
    expect(getByTestId("count").textContent).toBe("1");
    unmount();
    const { getByTestId: read } = render(
      <OmniCatalogProvider>
        <Reader />
      </OmniCatalogProvider>,
    );
    expect(read("count").textContent).toBe("0");
  });

  it("defers to another publisher when disabled", () => {
    const other: OmniCatalog = {
      ...EMPTY_OMNI_CATALOG,
      openItems: [{ id: "i1", title: "Premium notice", kind: "missing", ref: null }],
    };
    function OpenReader() {
      const count = useOmniCatalog().openItems.length;
      return <span data-testid="open-count">{count}</span>;
    }
    const { getByTestId } = render(
      <OmniCatalogProvider>
        <Publisher catalog={STABLE} enabled={false} />
        <Publisher catalog={other} />
        <OpenReader />
      </OmniCatalogProvider>,
    );
    expect(getByTestId("open-count").textContent).toBe("1");
  });
});