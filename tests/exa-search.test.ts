import { describe, expect, test } from "bun:test";
import { clampSearchResultCount, parseExaSearchResponse } from "../shared/webSearch";

describe("web search policy", () => {
  test("clamps the requested result count to a safe range", () => {
    expect(clampSearchResultCount(undefined)).toBe(5);
    expect(clampSearchResultCount("not a number")).toBe(5);
    expect(clampSearchResultCount(0)).toBe(1);
    expect(clampSearchResultCount(3.9)).toBe(3);
    expect(clampSearchResultCount(500)).toBe(10);
  });

  test("reduces an Exa response to titles, links, and bounded snippets", () => {
    const results = parseExaSearchResponse({
      results: [
        {
          title: "Quarterly automation report",
          url: "https://example.com/report",
          text: "x".repeat(2000),
          publishedDate: "2026-08-01",
        },
        { url: "https://example.com/untitled", summary: "A short summary." },
      ],
    });
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      title: "Quarterly automation report",
      url: "https://example.com/report",
      publishedDate: "2026-08-01",
    });
    expect(results[0]!.snippet.length).toBeLessThanOrEqual(500);
    expect(results[1]).toEqual({
      title: "https://example.com/untitled",
      url: "https://example.com/untitled",
      snippet: "A short summary.",
    });
  });

  test("ignores malformed payloads and entries without a URL", () => {
    expect(parseExaSearchResponse(null)).toEqual([]);
    expect(parseExaSearchResponse("nope")).toEqual([]);
    expect(parseExaSearchResponse({ results: "nope" })).toEqual([]);
    expect(parseExaSearchResponse({ results: [{ title: "No link" }, null, 42] })).toEqual([]);
  });
});
