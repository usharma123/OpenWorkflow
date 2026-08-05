import { describe, expect, test } from "bun:test";
import { validateWorkflowConnection } from "../src/lib/workflowConnections";

const edge = (id: string, source: string, target: string, sourceHandle?: string) => ({
  id,
  source,
  target,
  sourceHandle,
  targetHandle: null,
});

describe("workflow connection validation", () => {
  test("allows normal links and branching to another node", () => {
    const edges = [edge("a-b", "a", "b")];
    expect(validateWorkflowConnection({ source: "a", target: "c", sourceHandle: null, targetHandle: null }, edges)).toBeUndefined();
  });

  test("rejects self-links and exact duplicate ports", () => {
    const edges = [edge("a-b", "a", "b", "true")];
    expect(validateWorkflowConnection({ source: "a", target: "a", sourceHandle: null, targetHandle: null }, edges)).toContain("itself");
    expect(validateWorkflowConnection({ source: "a", target: "b", sourceHandle: "true", targetHandle: null }, edges)).toContain("already connected");
  });

  test("rejects direct and indirect cycles", () => {
    const edges = [edge("a-b", "a", "b"), edge("b-c", "b", "c")];
    expect(validateWorkflowConnection({ source: "c", target: "a", sourceHandle: null, targetHandle: null }, edges)).toContain("loop");
  });

  test("ignores the old edge while validating a reconnection", () => {
    const edges = [edge("a-b", "a", "b")];
    expect(validateWorkflowConnection({ source: "a", target: "b", sourceHandle: null, targetHandle: null }, edges, "a-b")).toBeUndefined();
  });
});
