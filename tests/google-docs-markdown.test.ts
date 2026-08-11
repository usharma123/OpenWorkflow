import { describe, expect, test } from "bun:test";
import { markdownToGoogleDocs } from "../shared/googleDocsMarkdown";

describe("Google Docs markdown formatting", () => {
  test("converts markdown syntax into native Docs formatting requests", () => {
    const result = markdownToGoogleDocs([
      "# Alphabet research",
      "",
      "A **strong** business with [primary sources](https://abc.xyz/investor/).",
      "",
      "- Search advertising",
      "- Google Cloud",
      "",
      "| Metric | Value |",
      "| --- | ---: |",
      "| Revenue | $100B |",
    ].join("\n"));

    expect(result.text).toContain("Alphabet research\n");
    expect(result.text).toContain("A strong business with primary sources.");
    expect(result.text).toContain("Metric\tValue\nRevenue\t$100B");
    expect(result.text).not.toContain("# ");
    expect(result.text).not.toContain("**");
    expect(result.text).not.toContain("| ---");
    expect(result.requests.some((request) =>
      (request.updateParagraphStyle as { paragraphStyle?: { namedStyleType?: string } } | undefined)
        ?.paragraphStyle?.namedStyleType === "HEADING_1")).toBe(true);
    expect(result.requests.some((request) => request.createParagraphBullets)).toBe(true);
    expect(result.requests.some((request) =>
      (request.updateTextStyle as { textStyle?: { bold?: boolean } } | undefined)?.textStyle?.bold === true)).toBe(true);
    expect(result.requests.some((request) =>
      (request.updateTextStyle as { textStyle?: { link?: { url?: string } } } | undefined)
        ?.textStyle?.link?.url === "https://abc.xyz/investor/")).toBe(true);
  });

  test("formats block quotes, inline code, and numbered lists", () => {
    const result = markdownToGoogleDocs("> Important uncertainty\n\n1. First\n2. Second\n\nUse `revenue`.");
    expect(result.text).toContain("Important uncertainty");
    expect(result.text).toContain("Use revenue.");
    expect(result.requests.some((request) =>
      (request.createParagraphBullets as { bulletPreset?: string } | undefined)?.bulletPreset
        === "NUMBERED_DECIMAL_ALPHA_ROMAN")).toBe(true);
    expect(result.requests.some((request) =>
      (request.updateTextStyle as { textStyle?: { weightedFontFamily?: { fontFamily?: string } } } | undefined)
        ?.textStyle?.weightedFontFamily?.fontFamily === "Roboto Mono")).toBe(true);
  });
});
