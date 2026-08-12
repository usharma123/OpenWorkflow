import { describe, expect, test } from "bun:test";
import { compactLiveValue, LIVE_OUTPUT_CHARS } from "../convex/liveState";

describe("bounded live execution state", () => {
  test("caps streamed text without changing short values", () => {
    expect(compactLiveValue("short")).toBe("short");
    const long = "x".repeat(LIVE_OUTPUT_CHARS);
    const compacted = compactLiveValue(long, 100);
    expect(typeof compacted).toBe("string");
    expect(String(compacted).length).toBeLessThan(130);
    expect(String(compacted)).toEndWith("…[truncated]");
  });

  test("replaces oversized objects with a bounded preview", () => {
    const compacted = compactLiveValue({ content: "x".repeat(10_000) }, 200) as {
      preview: string;
      truncated: boolean;
    };
    expect(compacted.truncated).toBe(true);
    expect(compacted.preview.length).toBeLessThanOrEqual(201);
  });
});
