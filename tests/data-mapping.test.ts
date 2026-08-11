import { describe, expect, test } from "bun:test";
import {
  appendMappingExpression,
  flattenMappingFields,
  mappingExpression,
  mappingSourcesForNode,
  upstreamNodeIds,
} from "../src/lib/dataMapping";
import type { RunStepSummary, WorkflowEdge } from "../src/types";

const edges = [
  { id: "one-two", source: "one", target: "two" },
  { id: "two-three", source: "two", target: "three" },
  { id: "other-three", source: "other", target: "three" },
] as WorkflowEdge[];

describe("data mapping", () => {
  test("finds every upstream step and excludes downstream nodes", () => {
    expect([...upstreamNodeIds("three", edges)].sort()).toEqual(["one", "other", "two"]);
    expect([...upstreamNodeIds("one", edges)]).toEqual([]);
  });

  test("discovers nested fields from the first array item", () => {
    const fields = flattenMappingFields({ messages: [{ subject: "Budget review", unread: true }], count: 1 });
    expect(fields.map((field) => field.path)).toContain("messages.0.subject");
    expect(fields.map((field) => field.path)).toContain("messages");
    expect(fields.find((field) => field.path === "count")?.preview).toBe("1");
  });

  test("uses completed outputs from the latest upstream run", () => {
    const steps: RunStepSummary[] = [
      { id: "s1", nodeId: "one", nodeLabel: "Inbox", nodeType: "gmailTrigger", status: "completed", startedAt: 1, output: { count: 3 } },
      { id: "s2", nodeId: "two", nodeLabel: "Draft", nodeType: "ai", status: "failed", startedAt: 2, error: "nope" },
      { id: "s3", nodeId: "later", nodeLabel: "Later", nodeType: "slack", status: "completed", startedAt: 3, output: { ok: true } },
    ];
    expect(mappingSourcesForNode("three", edges, steps).map((source) => source.nodeId)).toEqual(["one"]);
  });

  test("builds and appends stable expressions", () => {
    const expression = mappingExpression("gmail-a1b2", "messages.0.subject");
    expect(expression).toBe("{{ steps.gmail-a1b2.messages.0.subject }}");
    expect(appendMappingExpression("Subject:", expression, false)).toBe(`Subject: ${expression}`);
    expect(appendMappingExpression("Summarize:", expression, true)).toBe(`Summarize:\n${expression}`);
  });
});
