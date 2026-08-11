import { describe, expect, test } from "bun:test";
import { workflowDraftFingerprint } from "../src/lib/workflowPersistence";
import type { WorkflowNode } from "../src/types";

function node(executionState: Partial<WorkflowNode> = {}): WorkflowNode {
  return {
    id: "agent-1",
    type: "workflow",
    position: { x: 10, y: 20 },
    data: {
      label: "Research",
      description: "Research a topic",
      nodeType: "ai",
      config: { prompt: "Investigate" },
      status: "running",
      runtimeAgents: [{
        id: "child-1",
        name: "sources",
        objective: "Find sources",
        status: "running",
        attempt: 1,
        startedAt: 1,
      }],
    },
    measured: { width: 220, height: 80 },
    ...executionState,
  };
}

function fingerprint(workflowNode: WorkflowNode) {
  return workflowDraftFingerprint({
    name: "Workflow",
    description: "",
    enabled: false,
    maxConcurrentRuns: 3,
    nodes: [workflowNode],
    edges: [],
  });
}

describe("workflow persistence boundary", () => {
  test("ignores live status, runtime agents, and measured layout", () => {
    const running = node();
    const completed = node({
      measured: { width: 260, height: 90 },
      data: { ...running.data, status: "success", runtimeAgents: [] },
    });
    expect(fingerprint(completed)).toBe(fingerprint(running));
  });

  test("changes when editable builder configuration changes", () => {
    const original = node();
    const edited = node({ data: { ...original.data, config: { prompt: "Investigate deeply" } } });
    expect(fingerprint(edited)).not.toBe(fingerprint(original));
  });
});
