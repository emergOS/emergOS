import { describe, expect, it } from "vitest";
import { createSimplePdf, escapePdfText } from "./generated-files";

describe("generated files", () => {
  it("creates a basic PDF document", () => {
    const pdf = createSimplePdf("Missing person flyer", ["Name: Ada", "Last seen: Berlin"]);
    const text = new TextDecoder().decode(pdf);

    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("/Type /Catalog");
    expect(text).toContain("xref");
  });

  it("escapes PDF text controls", () => {
    expect(escapePdfText("A (B) \\ C\nD")).toBe("A \\(B\\) \\\\ C D");
  });
});
