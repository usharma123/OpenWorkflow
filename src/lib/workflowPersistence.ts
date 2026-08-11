import type { Edge } from "@xyflow/react";
import type { WorkflowNode } from "../types";

/** Strip execution-only and React Flow measurement state before persistence. */
export function persistableNodes(nodes: WorkflowNode[]): WorkflowNode[] {
  const persisted = nodes.map((node) => {
    const { status: _status, runtimeAgents: _runtimeAgents, ...data } = node.data;
    const isBoundary = data.nodeType === "daytonaSandbox";
    return {
      id: node.id,
      type: isBoundary ? "sandbox" as const : "workflow" as const,
      position: node.position,
      data,
      ...(node.parentId ? { parentId: node.parentId, extent: "parent" as const } : {}),
      ...(isBoundary ? {
        initialWidth: node.measured?.width ?? node.width ?? node.initialWidth ?? 560,
        initialHeight: node.measured?.height ?? node.height ?? node.initialHeight ?? 320,
      } : {}),
    };
  });
  return persisted.sort((left, right) =>
    Number(right.data.nodeType === "daytonaSandbox") - Number(left.data.nodeType === "daytonaSandbox"));
}

export function workflowDraftFingerprint(draft: {
  name: string;
  description: string;
  enabled: boolean;
  maxConcurrentRuns: number;
  nodes: WorkflowNode[];
  edges: Edge[];
}): string {
  return JSON.stringify({ ...draft, nodes: persistableNodes(draft.nodes) });
}
