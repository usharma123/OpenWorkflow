import type { Edge } from "@xyflow/react";
import { catalogByType } from "../catalog";
import type { WorkflowNode, WorkflowNodeType } from "../types";

export interface MaterializedProposal {
  nodes: WorkflowNode[];
  edges: Edge[];
  name?: string;
  description?: string;
}

interface ProposalShape {
  name?: string;
  description?: string;
  nodes: unknown[];
  edges: unknown[];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Turn a build-chat proposal into canvas nodes and edges: validate types
 * against the catalog, merge default configs, mint fresh ids, and lay steps
 * out left-to-right by graph depth.
 */
export function materializeProposal(proposal: ProposalShape): MaterializedProposal {
  const idMap = new Map<string, string>();
  const accepted: Array<{ oldId: string; type: WorkflowNodeType; label: string; description: string; config: Record<string, unknown> }> = [];

  for (const item of proposal.nodes) {
    const entry = asRecord(item);
    const oldId = String(entry.id ?? "").trim();
    const type = String(entry.type ?? "").trim() as WorkflowNodeType;
    const catalogItem = catalogByType[type];
    if (!oldId || idMap.has(oldId) || !catalogItem || catalogItem.hidden) continue;
    idMap.set(oldId, `${type}-${crypto.randomUUID().slice(0, 8)}`);
    accepted.push({
      oldId,
      type,
      label: String(entry.label ?? "").trim() || catalogItem.label,
      description: String(entry.description ?? "").trim() || catalogItem.description,
      config: { ...structuredClone(catalogItem.defaultConfig), ...asRecord(entry.config) },
    });
  }
  if (!accepted.length) throw new Error("The proposal contains no steps this editor supports.");

  const edgePairs: Array<{ source: string; target: string; sourceHandle?: string }> = [];
  const seenEdges = new Set<string>();
  for (const item of proposal.edges) {
    const entry = asRecord(item);
    const source = idMap.get(String(entry.source ?? ""));
    const target = idMap.get(String(entry.target ?? ""));
    const sourceHandle = ["true", "false", "error"].includes(String(entry.sourceHandle ?? ""))
      ? String(entry.sourceHandle)
      : undefined;
    if (!source || !target || source === target) continue;
    const key = `${source}:${target}:${sourceHandle ?? ""}`;
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    edgePairs.push({ source, target, ...(sourceHandle ? { sourceHandle } : {}) });
  }

  // Depth = longest path from a root, so parallel branches share a column.
  const newIds = accepted.map((node) => idMap.get(node.oldId)!);
  const depth = new Map<string, number>(newIds.map((id) => [id, 0]));
  for (let pass = 0; pass < newIds.length; pass += 1) {
    let changed = false;
    for (const edge of edgePairs) {
      const next = (depth.get(edge.source) ?? 0) + 1;
      if (next > (depth.get(edge.target) ?? 0)) {
        depth.set(edge.target, next);
        changed = true;
      }
    }
    if (!changed) break;
  }
  const rowsByDepth = new Map<number, number>();

  const nodes: WorkflowNode[] = accepted.map((node) => {
    const id = idMap.get(node.oldId)!;
    const column = depth.get(id) ?? 0;
    const row = rowsByDepth.get(column) ?? 0;
    rowsByDepth.set(column, row + 1);
    return {
      id,
      type: "workflow",
      position: { x: 40 + column * 265, y: 120 + row * 150 },
      data: {
        label: node.label,
        description: node.description,
        nodeType: node.type,
        config: node.config,
      },
    };
  });

  const edges: Edge[] = edgePairs.map((edge, index) => ({
    id: `e-${index}-${edge.source}-${edge.target}${edge.sourceHandle ? `-${edge.sourceHandle}` : ""}`,
    source: edge.source,
    target: edge.target,
    ...(edge.sourceHandle ? { sourceHandle: edge.sourceHandle } : {}),
    animated: true,
  }));

  return {
    nodes,
    edges,
    name: proposal.name?.trim() || undefined,
    description: proposal.description?.trim() || undefined,
  };
}
