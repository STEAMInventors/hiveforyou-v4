import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { pdfjs } from "react-pdf";

const require = createRequire(import.meta.url);

describe("pdfjs-dist version alignment", () => {
  it("matches the pdfjs API version exposed by react-pdf", () => {
    const pdfjsDistPkgJson = require.resolve("pdfjs-dist/package.json", {
      paths: [require.resolve("react-pdf")],
    });
    const { version } = JSON.parse(readFileSync(pdfjsDistPkgJson, "utf8")) as { version: string };
    expect(version).toBe(pdfjs.version);
  });
});
