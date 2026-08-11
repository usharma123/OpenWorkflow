import { describe, expect, test } from "bun:test";
import { compactAgentOutput, referencedStepIds } from "../shared/executionPayload";

describe("workflow execution payloads", () => {
  test("removes duplicated subagent detail and bounds research fan-in", () => {
    const largeResult = {
      content: "r".repeat(100_000),
      citations: Array.from({ length: 100 }, (_, index) => ({
        title: `Source ${index}`.repeat(100),
        url: `https://example.com/${index}/${"u".repeat(2_000)}`,
      })),
      artifacts: Array.from({ length: 10 }, (_, index) => ({
        type: "report",
        path: `report-${index}.md`,
        content: "a".repeat(80_000),
      })),
      toolTrace: Array.from({ length: 200 }, () => ({ tool: "web_search", summary: "searched", ok: true })),
      subagents: Array.from({ length: 3 }, () => ({ content: "s".repeat(80_000) })),
      model: "test/model",
      useCompute: true,
    };
    const compact = compactAgentOutput({ requestedBy: "Editor" }, largeResult) as Record<string, unknown>;
    expect(compact.subagents).toBeUndefined();
    expect(compact.toolTrace).toBeUndefined();
    expect((compact.content as string).length).toBe(32_000);
    expect((compact.citations as unknown[]).length).toBe(20);
    expect((compact.artifacts as unknown[]).length).toBe(4);

    const eightWayMerge = JSON.stringify({ items: Array.from({ length: 8 }, () => compact) });
    expect(eightWayMerge.length).toBeLessThan(1_000_000);
    const retrySeed = JSON.stringify({
      seedOutputs: Object.fromEntries(Array.from({ length: 8 }, (_, index) => [`research-${index}`, compact])),
    });
    expect(retrySeed.length).toBeLessThan(1_000_000);
  });

  test("only selects step outputs explicitly referenced by templates", () => {
    expect(referencedStepIds({
      prompt: "Compare {{input}} with {{steps.research-us.content}} and {{ steps.research-eu.citations }}.",
      nested: ["Reuse {{steps.research-us.model}}"],
    })).toEqual(["research-us", "research-eu"]);
    expect(referencedStepIds({ prompt: "Summarize {{input}}" })).toEqual([]);
  });
});
