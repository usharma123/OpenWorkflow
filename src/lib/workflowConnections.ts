import type { Connection, Edge } from "@xyflow/react";

type ConnectionLike = Pick<Connection, "source" | "target" | "sourceHandle" | "targetHandle">;
type EdgeLike = Pick<Edge, "id" | "source" | "target" | "sourceHandle" | "targetHandle">;

function sameHandle(left: string | null | undefined, right: string | null | undefined) {
  return (left ?? null) === (right ?? null);
}

export function validateWorkflowConnection(
  connection: ConnectionLike,
  edges: EdgeLike[],
  ignoredEdgeId?: string,
): string | undefined {
  const { source, target } = connection;
  if (!source || !target) return "Drop the connection on an input port.";
  if (source === target) return "A step cannot connect to itself.";

  const remainingEdges = ignoredEdgeId
    ? edges.filter((edge) => edge.id !== ignoredEdgeId)
    : edges;

  const duplicate = remainingEdges.some((edge) =>
    edge.source === source &&
    edge.target === target &&
    sameHandle(edge.sourceHandle, connection.sourceHandle) &&
    sameHandle(edge.targetHandle, connection.targetHandle));
  if (duplicate) return "Those two ports are already connected.";

  const outgoing = new Map<string, string[]>();
  for (const edge of remainingEdges) {
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  }

  const pending = [target];
  const visited = new Set<string>();
  while (pending.length) {
    const nodeId = pending.pop()!;
    if (nodeId === source) return "That connection would create a loop.";
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);
    pending.push(...(outgoing.get(nodeId) ?? []));
  }

  return undefined;
}
